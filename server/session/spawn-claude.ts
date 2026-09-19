import { isBotSession } from "../bots/session-marker.js";
import { noteBotUserInput } from "../bots/input-gate.js";
// Starting a claude session in a PTY and wiring it to the browser. The most entangled
// piece of index.ts (#548 step 3c): it spans the CLI args, the
// sidebar's optimistic row, the draft typed into the input box, and teardown on exit.
import type { WebSocket } from "ws";
import { CLAUDE_CWD, PORT } from "../config/env.js";
import { guiMcpEnv, carriesFullGuiMcp, fullGuiAllowedTools } from "./mcp-config.js";
import { getUserMcpServers, getPrWorkdirFooter, getAppendSystemPrompt, getTerminalSubmit, getCustomAgents } from "../config/config-routes.js";
import { submitSequenceForAgent } from "../../common/terminalSubmit.js";
import { buildClaudeArgs } from "../agents/claude-args.js";
import { claudeAdapter } from "../agents/claude.js";
import { appendedSystemPrompt } from "../agents/appended-prompt.js";
import {
  claimFullGuiMcp,
  customAgentSessions,
  hookedSessions,
  knownSessions,
  launchChoices,
  ptys,
  rememberCustomAgentSession,
  resetSessionToolGroups,
} from "./registry.js";
import { ptySpawn, ptyWouldReattach, type PtySpawnEnv } from "./pty-spawn.js";
import { ptyExitLine, ptyStartLine } from "./pty-exit-log.js";
import { attachDraftInjection } from "./draft-injection.js";
import { sendExitAndClose } from "./ws-frames.js";
import { wireBufferedOutput } from "./output-relay.js";
import { sessionExistsOnDisk } from "./session-reads.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";
import { handlePtyExit } from "./pty-exit.js";
import { loadDirConfig } from "../config/dir-config.js";
import { repoRootSync } from "../git/repo-root-sync.js";
import { workdirFooter } from "../git/pr-footer.js";
import { getProviders } from "../config/config-routes.js";
import { requireResolution, resolveProvider, type DirModelChoice } from "./provider-env.js";
import { settingsArgument, mcpConfigArgument, appendedPromptArgument, withSettingsCleanup, type AppendedPromptArgument } from "./session-settings.js";
import { ensureDropsDir } from "./session-drops.js";
import { effectiveChoice } from "./launch-choice.js";
import { customAgentLaunch } from "./custom-agent-command.js";
import type { CustomAgent } from "../../common/customAgents.js";

export interface SpawnClaudeOptions {
  /** Persistent Bot instructions survive CLI compaction. Host-only, never a URL parameter. */
  botRole?: string;
  // Passed to claude as the first turn, so the session starts working before anyone
  // opens it. Mutually exclusive with `draft`.
  initialPrompt?: string;
  cwd?: string;
  /** NOT a grid cell — the single view, or a chat spawned with no cell of its own yet. It is one
   *  of the two ways a session earns the full GUI MCP; the other is running in the workspace
   *  itself, which is derived from `cwd` rather than passed (see fullGuiMcp below). */
  attachGuiMcp?: boolean;
  // Typed into the input box once claude is ready, NOT submitted — the user reviews it.
  draft?: string;
  // What the browser picked in the launch form (#584). Replaces the directory's default
  // as a PAIR: a provider from one source with a model from the other is a combination
  // neither of them asked for. Absent — the usual case — means "use the directory's".
  launch?: DirModelChoice | undefined;
  /** The id of a CUSTOM AGENT picked in the Agent Picker: run the user's own command line with
   *  Claude Code's argv appended to it, instead of the `claude` binary with that argv (#1414).
   *  Everything else about this session is unchanged — same flags, same hooks, same session id,
   *  same resume — which is the entire point (common/customAgents.ts).
   *
   *  An ID, not the entry: the configured list is the allowlist and it is read HERE, per spawn,
   *  so an edited command reaches the next session without a restart and the browser can never
   *  name a program that is not in the config. Absent = plain claude. */
  customAgentId?: string | undefined;
}

// The `work in <clone>` line for a session's PRs, or null when the footer is switched off or the
// directory is not a git repo (nothing to name).
//
// Resolved HERE rather than left to the agent: inside a managed worktree an agent would name the
// worktree, and the clone is what identifies the work (the branch is already on the PR). Read per
// spawn, like the ⧉ Open PR button reads it per PR, so switching it off needs no restart.
function sessionWorkdirFooter(cwd: string): string | null {
  if (!getPrWorkdirFooter()) return null;
  const root = repoRootSync(cwd);
  return root ? workdirFooter(root) : null;
}

// What `--append-system-prompt` carries for this session (#1062), and where it travels. Every
// source is read per spawn, so switching any section off needs no restart.
//
// The placement happens here, beside the other two arguments a Windows spawn has to send as a
// path (settingsArgument / mcpConfigArgument): the text is multi-line, and a Windows command line
// cannot carry a newline at all (#1516).
function sessionAppendedPrompt(sessionId: string, cwd: string, dirSetting: boolean | null, botRole?: string): AppendedPromptArgument | null {
  const prompt = appendedSystemPrompt({ dirSetting, globalSetting: getAppendSystemPrompt(), workdirFooter: sessionWorkdirFooter(cwd) });
  const botPrompt =
    botRole === undefined
      ? null
      : `You are a hidden background Bot. Communicate only with the frontend using replyToFrontend for each host requestId, then end the turn. Never poll or sleep waiting for work. Never use interactive questions; report a question via replyToFrontend. Never create other Bots. Your role: ${botRole}`;
  const combined = [prompt, botPrompt].filter(Boolean).join("\n\n");
  return combined ? appendedPromptArgument(sessionId, combined) : null;
}

// The sidebar row a session gets before it has a transcript. A session spawned to run something
// (an initial prompt or a draft) is named after that text, so it is recognizable there before
// anyone opens it; anything else is just "New session".
function newSessionTitle(seed: string | undefined): string {
  return (seed ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "New session";
}

// What this session runs, and the directory config it runs under (#579). A refusal THROWS:
// falling back to Anthropic would send this session's prompts to a backend the directory did not
// select, which is exactly what the provider contract exists to prevent. The ws route turns it
// into a message in the terminal.
//
// Its own function because the spawn body is at its line budget and this is one decision made
// from three sources, not part of spawning.
function resolveSessionBackend(input: { cwd: string; sessionId: string; launch?: DirModelChoice | undefined; canResume: boolean }) {
  const dir = loadDirConfig(input.cwd);
  const choice = effectiveChoice({
    launch: input.launch,
    remembered: launchChoices.get(input.sessionId),
    dir: { provider: dir.provider, model: dir.model },
    resuming: input.canResume,
  });
  const resolved = requireResolution(resolveProvider(choice, getProviders(), process.env));
  // Remembered so a later resume continues on the backend this session began on, instead of
  // silently moving to the directory's default mid-conversation.
  if (input.launch) launchChoices.set(input.sessionId, choice);
  return { dir, resolved };
}

/**
 * The directories this session may read outside its cwd. A file dropped into the session is saved
 * outside it, so the agent would meet a permission prompt on every Read without this. Granted at
 * spawn rather than per drop because `--add-dir` is a spawn-time flag: a session already running
 * cannot be given one later.
 *
 * Its own function for the same reason resolveSessionBackend is — the spawn body is at its line
 * budget, and this is a value derived from two sources rather than part of spawning.
 */
function sessionAddDirs(sessionId: string, configured: string[] | null | undefined): string[] | null | undefined {
  const dropsDirectory = ensureDropsDir(sessionId);
  return dropsDirectory ? [...(configured ?? []), dropsDirectory] : configured;
}

/**
 * Which custom agent, if any, this session runs — the request's, or the one it was STARTED on.
 *
 * Remembered exactly as the provider/model choice is (launchChoices, #584), and resolved by the
 * same rule (effectiveChoice): **a resume ignores the picker entirely.** The browser re-sends
 * whatever its cell still holds on every reconnect, and that value belongs to the session the cell
 * launched, not to the one being resumed — so picking a custom agent and then clicking a plain
 * Claude row in "or resume here" would otherwise continue that conversation under a wrapper, on a
 * different model, mid-thread. What the session was started on is the only defensible answer.
 *
 * PERSISTED, unlike launchChoices — it survives reap and a restart (custom-agent-log.ts). It has
 * to: the transcript outlives the pty, and with the picker ignored on resume there would be
 * nothing left to say how that conversation was being run. (A tmux REATTACH is unaffected either
 * way: it picks up the running process and never re-reads argv.)
 */
function resolveCustomAgent(sessionId: string, requestedId: string | undefined, resuming: boolean): CustomAgent | undefined {
  const id = resuming ? customAgentSessions.get(sessionId) : requestedId;
  if (!id) return undefined;
  const agent = getCustomAgents().find((candidate) => candidate.id === id);
  // An id the config no longer has resolves to nothing and this session starts on plain claude —
  // but the mapping is left alone rather than erased. The log only grows (it is shared between
  // instances, so nothing rewrites it), and keeping the name costs nothing: re-adding the entry
  // puts the session back on the agent it was started on, which is what its user chose.
  if (agent) rememberCustomAgentSession(sessionId, agent.id);
  return agent;
}

/**
 * WHAT program runs this session, and what goes in front of Claude Code's own argv.
 *
 * Plain claude is `claudeBin` with nothing in front. A custom agent is the user's command line
 * split into argv, with claude's flags appended — `ollama launch claude --model … --` becomes
 * `ollama` + `["launch","claude","--model","…","--", <every claude flag>]`. The entry says which
 * agent it launches AS (`agent: "claude"`), which is what makes appending claude's argv correct
 * rather than a guess about the command text.
 *
 * `binEnvVar` goes with the program, which is why the spawn ENVIRONMENT is assembled here too: it
 * names the env override that would FIX an unrunnable one (CLAUDE_BIN), and passing it opts the
 * spawn into the pre-flight check (see ptySpawn). A custom agent has no such override — the fix is
 * the config entry — so it is left off, which is the documented "the caller owns the failure" path
 * and puts the child's own error in the terminal.
 *
 * A custom agent whose command tokenizes to nothing falls back to plain claude rather than
 * refusing: config sanitizing already requires a non-empty command, so this is unreachable short
 * of a bug, and starting the session the user asked for beats a blank cell.
 *
 * `note` is the start-log line's suffix. The wrapper is named there rather than left to be
 * inferred: `[pty] claude started` for a session actually running `ollama` is exactly what would
 * mislead someone debugging "why is this session on the wrong model".
 */
function sessionProgram(
  claudeBin: string,
  sessionId: string,
  customAgentId: string | undefined,
  resume: string | null,
  unset: readonly string[],
): { file: string; prefixArgs: string[]; spawnEnv: PtySpawnEnv; note: string | null } {
  // `resume` is non-null exactly when this is a continuation (the caller passes it only for a
  // resumable transcript), which is the same signal effectiveChoice takes as `resuming`.
  const customAgent = resolveCustomAgent(sessionId, customAgentId, resume !== null);
  const note = [customAgent ? `via ${customAgent.id}` : null, resume ? `resume ${resume}` : null].filter(Boolean).join(" ") || null;
  const env = { unset, env: guiMcpEnv(sessionId, PORT) };
  const launch = customAgent ? customAgentLaunch(customAgent.command) : null;
  if (!launch) return { file: claudeBin, prefixArgs: [], spawnEnv: { ...env, binEnvVar: claudeAdapter.binEnvVar }, note };
  return { file: launch.file, prefixArgs: launch.prefixArgs, spawnEnv: env, note };
}

function prepareDraftInjection(entry: PtyEntry, id: string, options: SpawnClaudeOptions): (data: string) => void {
  const { initialPrompt, draft, botRole } = options;
  if (initialPrompt || draft) noteBotUserInput(id);
  return attachDraftInjection(entry, initialPrompt, draft, () => submitSequenceForAgent(entry.agent, getTerminalSubmit()), botRole !== undefined);
}

export function createClaudeSpawner(deps: SpawnDeps) {
  // Spawn a fresh claude PTY for this session, register it, and wire its output /
  // exit back to the browser socket. `ws` may be null for a session spawned without
  // a viewer yet (e.g. spawnBackgroundChat) — output just buffers until a client
  // reattaches.
  function spawnClaudePty(sessionId: string, resume: string | null, ws: WebSocket | null, options: SpawnClaudeOptions = {}): PtyEntry {
    const { initialPrompt, cwd = CLAUDE_CWD, attachGuiMcp = true, draft, launch, customAgentId } = options;
    const fullGuiMcp = carriesFullGuiMcp(attachGuiMcp, cwd, "claude");
    // fullGuiMcp picks the MCP mode (see buildClaudeArgs, and its own doc for who earns it): our
    // broker on one all-tools url; a project-directory cell gets none of ours and loads the GUI
    // tools its own directory registered. Either way the user's own MCP servers load.
    // Only --resume when the session has an on-disk transcript — claude doesn't write
    // a session's .jsonl until its first prompt, so a started-but-unused session can't
    // be resumed; we restart fresh (reusing the id via --session-id) instead.
    const canResume = resume !== null && sessionExistsOnDisk(resume, cwd);

    const { dir, resolved } = resolveSessionBackend({ cwd, sessionId, launch, canResume });
    const addDirs = sessionAddDirs(sessionId, dir.addDirs);

    const hookSettings = deps.hookSettingsJson("localhost", sessionId, resolved.env);
    const mcpJson = deps.mcpConfigJson(sessionId, "127.0.0.1");
    // File-ized only when it is actually passed (fullGuiMcp), so a cell that never carries
    // the GUI MCP leaves no file behind for reap to clean up.
    const mcpConfig = fullGuiMcp ? mcpConfigArgument(sessionId, mcpJson) : mcpJson;
    const args = buildClaudeArgs({
      model: resolved.model,
      sessionId,
      resume,
      canResume,
      // A provider session's settings carry its token, so they go to a 0600 file instead of
      // argv — see session-settings.ts.
      settings: settingsArgument(sessionId, hookSettings, Object.keys(resolved.env).length > 0),
      permissionMode: deps.permissionMode,
      attachGuiMcp: fullGuiMcp,
      mcpConfig,
      // Carrying the whole GUI MCP: auto-allow the GUI tools + the user's own configured MCP
      // servers (mcp__<id>), so their tools don't trip a permission prompt on every call.
      // A project-directory cell: no --mcp-config at all, so there is nothing of ours to name —
      // except the tool GROUPS the directory may have registered itself, which we pre-approve
      // blind (see GRID_MCP_TOOLS). The user's own servers keep their normal prompts there, since
      // that path never went through our allowlist before.
      allowedTools: fullGuiMcp ? fullGuiAllowedTools(deps.guiMcpTools, getUserMcpServers()) : deps.gridMcpTools,
      addDirs,
      appendedPrompt: sessionAppendedPrompt(sessionId, cwd, dir.appendSystemPrompt, options.botRole),
    });

    console.log(`[ws] client connected (${canResume ? "resume" : "new"} ${sessionId})`);

    // Sandbox → run claude inside a fresh container (no tmux). Otherwise the host path:
    // a live tmux session for this id (survived a restart) reattaches; else create it.
    // The settings file is already on disk and may hold a provider token, so a failed
    // spawn has to take it with it — a session that never starts never reaches reap(),
    // where the cleanup normally happens (#579).
    const entry = withSettingsCleanup(sessionId, spawnEntry);
    const spawnedAtMs = Date.now();

    // A NEW claude process gets whatever the user's MCP config says NOW, so anything this id
    // learned under a previous one is stale — including a group the user has since removed.
    //
    // But this function is also the REATTACH path: after the server restarts (a --watch reload
    // included), the pty map is empty while the tmux session and its claude are still running, so
    // ws-routes comes back through here and `new-session -A` picks the same process back up.
    // Nothing is re-read there, and an MCP client that connected once will not connect again — so
    // resetting would drop a capability with no way left to relearn it, and the panel would tell a
    // cell that is still drawing that Canvas is not enabled for it. Surviving exactly that is what
    // the persisted log is FOR; the unconditional reset was undoing it on every restart.
    //
    // Asked HERE, one statement before the spawn, rather than up with the other decisions: the
    // answer stops being true the moment the tmux session ends, and everything between the two
    // (the provider resolution, the git probes, the settings file) is time in which it can. The
    // remaining window is irreducible without tmux reporting which branch `-A` took, and what
    // survives it is an over-reported group on a session that lost it — the next genuinely new
    // process clears that, whereas the reverse mistake could not be undone at all.
    //
    // The all-tools claim rides the SAME probe rather than taking its own: asking twice would widen
    // exactly the window this is placed here to keep narrow. It is passed the answer instead of
    // asking, and decides for itself what a reattach means for each direction (see claimFullGuiMcp).
    function recordCapabilitiesForThisSpawn(): void {
      const reattaching = ptyWouldReattach(sessionId, true);
      if (!reattaching) resetSessionToolGroups(sessionId);
      claimFullGuiMcp(sessionId, attachGuiMcp, cwd, reattaching, "claude");
    }

    function spawnEntry(): PtyEntry {
      recordCapabilitiesForThisSpawn();
      const program = sessionProgram(deps.claudeBin, sessionId, customAgentId, canResume ? resume : null, resolved.unset);
      const { term, tmux, reattached } = ptySpawn(sessionId, program.file, [...program.prefixArgs, ...args], cwd, true, program.spawnEnv);
      if (reattached && !isBotSession(sessionId)) noteBotUserInput(sessionId);
      console.log(ptyStartLine({ agent: "claude", pid: term.pid, cwd, tmux, reattached, sessionId, note: program.note }));
      return { term, ws, buffer: "", cwd, tmux, active: false, agent: "claude" }; // "claude" whatever wrapper started it — see sessionProgram
    }
    ptys.set(sessionId, entry);
    // Every claude spawn above carries `--settings` with the Pre/PostToolUse hooks, so from here
    // on this session reports its own tool calls — which is what stops the MCP broker recording
    // its GUI calls a second time (mcp/gui-call-history.ts).
    hookedSessions.add(sessionId);

    if (!canResume && !isBotSession(sessionId)) {
      // Brand-new (or restarted-idle) session: surface it in the sidebar before it's persisted.
      knownSessions.set(sessionId, { createdAt: Date.now(), title: newSessionTitle(initialPrompt ?? draft) });
      deps.publishSessionCreated(sessionId);
    }

    // The auto-run prompt / editable draft is typed into the input box once ready (see
    // attachDraftInjection) — its scanner is fed the pty output below. The submit byte(s)
    // are resolved per send, the same live config read and agent scoping the phone's submit
    // uses (index.ts) — an `esc-cr` host submits on ESC+CR, so a hardcoded CR would land as a
    // newline and the prompt would never run (#1148).
    const scanForDraftReady = prepareDraftInjection(entry, sessionId, options);

    // PTY -> browser (buffering a tail for reattach, batching the frames).
    const output = wireBufferedOutput(entry, deps.outputBufferLimit, scanForDraftReady);

    entry.term.onExit(({ exitCode, signal }) => {
      console.log(ptyExitLine({ agent: "claude", exitCode, signal, lifetimeMs: Date.now() - spawnedAtMs, cwd, sessionId }));
      output.flush(); // a queued batch must not arrive after the exit frame
      sendExitAndClose(entry.ws, exitCode, signal);
      // Clear the dot if it died mid-turn, then tear down everything (deletes
      // ptys/knownSessions/activity and publishes "closed") so a process that
      // exits on its own — e.g. a brand-new session that never persisted —
      // doesn't linger in the sidebar.
      deps.setWorking(sessionId, false);
      // Not always a reap: under tmux this pty is the CLIENT, and one killed from outside leaves
      // the session running (#1496). handlePtyExit asks tmux which of the two just happened.
      handlePtyExit(sessionId, deps.reap);
    });

    return entry;
  }

  return { spawnClaudePty };
}
