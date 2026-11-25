// Starting a claude session in a PTY and wiring it to the browser. The most entangled
// piece of index.ts (#548 step 3c): it spans the CLI args, the
// sidebar's optimistic row, the draft typed into the input box, and teardown on exit.
import type { WebSocket } from "ws";
import { CLAUDE_CWD, PORT } from "../../../config/env.js";
import { guiMcpEnv, carriesFullGuiMcp, directoryGroupsMcpConfigJson, fullGuiAllowedTools, restrictedAllowedTools } from "../setup/mcp-config.js";
import type { ToolGroup } from "../../../../common/toolGroups.js";
import {
  getUserMcpServers,
  getPrWorkdirFooter,
  getAppendSystemPrompt,
  getTerminalSubmit,
  getCustomAgents,
  getTokenRotation,
} from "../../../config/config-routes.js";
import type { TokenAssignment } from "../../../agents/token/token-assignment.js";
import { submitSequenceForAgent } from "../../../../common/terminalSubmit.js";
import { buildClaudeArgs } from "../../../agents/claude/claude-args.js";
import { refuseUnsupportedPermissionMode } from "../../../agents/claude/claude-help-probe.js";
import { claudeAdapter } from "../../../agents/claude/claude.js";
import { appendedSystemPrompt } from "../../../agents/appended-prompt.js";
import { customAgentSessions, hookedSessions, knownSessions, launchChoices, rememberCustomAgentSession, resetSessionToolGroups } from "../../registry.js";
import { ptyWouldReattach, type PtySpawnEnv } from "../../pty/pty-spawn.js";
import { ptyExitLine } from "../../pty/pty-exit-log.js";
import { startAgentPty, type StartedAgentPty } from "../../pty/agent-pty-start.js";
import { sessionGuiRestriction } from "./session-gui-restriction.js";
import { sessionPermissionMode } from "./session-permission-mode.js";
import { spawnWithFullGuiClaim } from "../spawn-with-full-gui-claim.js";
import { attachDraftInjection } from "../draft-injection.js";
import { sendFrame } from "../../ws-frames.js";
import { wireBufferedOutput } from "../../pty/output-relay.js";
import { sessionExistsOnDisk } from "../../session-reads.js";
import { accountSpawnEnv } from "../../session-home.js";
import { boundAccount } from "../../accounts/account-sessions.js";
import { sessionCredential, type SessionCredential } from "../../credentials/session-credential.js";
import { rememberTokenSession, sessionToken } from "../../credentials/token-sessions.js";
import { movedNoticeLine, takeMovedFrom } from "../../credentials/rotation-notice.js";
import { rotationLoginLabel } from "../../../../common/tokenRotation.js";
import { announceCredential } from "../../credentials/credential-announce.js";
import { takeSwitchedToken } from "../../credentials/token-switch-pins.js";
import type { PtyEntry } from "../../types.js";
import type { SpawnDeps } from "../spawn-deps.js";
import { isCurrentPty, reportPtyExit } from "../../pty/pty-exit.js";
import { loadDirConfig } from "../../../config/dir/dir-config.js";
import { repoRootSync } from "../../../git/repo-root-sync.js";
import { workdirFooter } from "../../../git/pr-footer.js";
import { getProviders } from "../../../config/config-routes.js";
import { claudeRendererEnv } from "./claude-fullscreen-env.js";
import { requireResolution, resolveProvider, type DirModelChoice } from "../setup/provider-env.js";
import { settingsArgument, mcpConfigArgument, appendedPromptArgument, withSettingsCleanup, type AppendedPromptArgument } from "../../session-settings.js";
import { ensureDropsDir } from "../../session-drops.js";
import { markDropsRootTrusted } from "../../drops-trust.js";
import { effectiveChoice } from "../launch-choice.js";
import { customAgentLaunch } from "./custom-agent-command.js";
import type { CustomAgent } from "../../../../common/customAgents.js";

/** The claude spawn, as the modules that are HANDED one see it. They take it as a dep rather than
 *  importing the spawner, because a spawner needs `SpawnDeps` — the boot's own wiring. */
export type SpawnClaudePty = (sessionId: string, resume: string | null, ws: WebSocket | null, options?: SpawnClaudeOptions) => PtyEntry;

export interface SpawnClaudeOptions {
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
  // The directory's GUI tool groups, for a project cell on a second login (#2215) — read by the
  // caller from the DEFAULT login's config, because that is where the launcher's switches live
  // and the account's own `.claude.json` has none of them. Empty for everything else.
  directoryMcpGroups?: readonly ToolGroup[];
  /** Limit this session to these GUI tool groups, for this spawn and every later one on the id
   *  (#3033). Absent leaves whatever was recorded before — on a fresh id, nothing. */
  guiGroups?: readonly ToolGroup[] | undefined;
  /** `--permission-mode` for this session instead of the server's. Remembered for the id, so every
   *  later spawn of it, a resume included, runs in it again (session-permission-mode.ts). */
  permissionMode?: string | undefined;
  /** More `--allowedTools` entries for this spawn only, such as a write rule for one folder (#3507).
   *  Not remembered for the id: a resume runs with the usual list. */
  extraAllowedTools?: readonly string[];
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
function sessionAppendedPrompt(sessionId: string, cwd: string, dirSetting: boolean | null): AppendedPromptArgument | null {
  const prompt = appendedSystemPrompt({ dirSetting, globalSetting: getAppendSystemPrompt(), workdirFooter: sessionWorkdirFooter(cwd) });
  return prompt === null ? null : appendedPromptArgument(sessionId, prompt);
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
/**
 * The credential this session's process is started with: the provider's, or — for a plain claude
 * cell on the default home, with rotation on — the token chosen for it (#2919). Its own function
 * for the reason resolveSessionBackend is.
 */
function sessionCredentialFor(
  deps: SpawnDeps,
  sessionId: string,
  resolved: ReturnType<typeof requireResolution>,
  customAgentId: string | undefined,
  resuming: boolean,
): SessionCredential {
  const agentId = resuming ? customAgentSessions.get(sessionId) : customAgentId;
  const runsCustomAgent = agentId !== undefined && getCustomAgents().some((candidate) => candidate.id === agentId);
  const onAccount = boundAccount("claude", sessionId) !== undefined;
  // A reattach starts nothing, but its settings file is still rewritten: it has to name the token the
  // running process was started with, never a fresh choice (spawnEntry records only a new process).
  // Asked only with rotation on, so the spawn's own reattach probe (spawnEntry) stays the only one
  // otherwise. A session ending between the two starts on its recorded token, which is still true.
  const assign = (): TokenAssignment | null => {
    if (!getTokenRotation().enabled) return null;
    if (ptyWouldReattach(sessionId, true)) return deps.keptAssignment?.(sessionToken(sessionId)) ?? null;
    // A subscription the user picked from the cell's mark (#2950) wins; one that cannot be read falls back to the usual choice.
    const picked = takeSwitchedToken(sessionId);
    const pickedAssignment = picked === undefined ? null : (deps.keptAssignment?.(picked) ?? null);
    return pickedAssignment ?? deps.assignToken?.() ?? null;
  };
  return sessionCredential(resolved, { providerEnv: resolved.env, runsCustomAgent, onAccount }, assign);
}

/** The line a session moved off a spent credential prints as its new process starts (#2919). */
function printMovedNotice(sessionId: string, ws: WebSocket | null, tokenId: string | null): void {
  const move = takeMovedFrom(sessionId);
  if (move === undefined || tokenId === null) return;
  sendFrame(ws, { type: "output", data: movedNoticeLine(move, rotationLoginLabel(getTokenRotation(), tokenId)) });
}

function sessionAddDirs(sessionId: string, configured: string[] | null | undefined): string[] | null | undefined {
  const dropsDirectory = ensureDropsDir(sessionId);
  if (!dropsDirectory) return configured;
  markDropsRootTrusted(sessionId);
  return [...(configured ?? []), dropsDirectory];
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
  permissionMode: string,
): { file: string; prefixArgs: string[]; spawnEnv: PtySpawnEnv; note: string | null } {
  // `resume` is non-null exactly when this is a continuation (the caller passes it only for a
  // resumable transcript), which is the same signal effectiveChoice takes as `resuming`.
  const customAgent = resolveCustomAgent(sessionId, customAgentId, resume !== null);
  const note = [customAgent ? `via ${customAgent.id}` : null, resume ? `resume ${resume}` : null].filter(Boolean).join(" ") || null;
  const env = { unset, env: { ...guiMcpEnv(sessionId, PORT), ...accountSpawnEnv("claude", sessionId) } };
  const launch = customAgent ? customAgentLaunch(customAgent.command) : null;
  // Only plain claude is asked whether it takes our --permission-mode (#2352): a custom agent's
  // command is the user's, and the claude it ends up running is not ours to find.
  const preflight = (childEnv: NodeJS.ProcessEnv) => refuseUnsupportedPermissionMode(claudeBin, permissionMode, childEnv);
  if (!launch) return { file: claudeBin, prefixArgs: [], spawnEnv: { ...env, binEnvVar: claudeAdapter.binEnvVar, preflight }, note };
  return { file: launch.file, prefixArgs: launch.prefixArgs, spawnEnv: env, note };
}

// What `--allowedTools` pre-approves. Carrying the whole GUI MCP: the GUI tools + the user's own
// configured MCP servers (mcp__<id>), so their tools don't trip a permission prompt on every call.
// A project-directory cell: no --mcp-config of ours, so there is nothing of ours to name — except
// the tool GROUPS the directory may have registered itself, which are pre-approved blind (see
// GRID_MCP_TOOLS). The user's own servers keep their normal prompts there, since that path never
// went through our allowlist before. A restricted session: only its own groups' share of that.
function claudeAllowedTools(deps: SpawnDeps, fullGuiMcp: boolean, restrictedTo: readonly ToolGroup[] | null): string {
  if (fullGuiMcp) return fullGuiAllowedTools(deps.guiMcpTools, getUserMcpServers());
  return restrictedTo === null ? deps.gridMcpTools : restrictedAllowedTools(deps.gridMcpTools, restrictedTo);
}

/** What this spawn of the id is limited to: its GUI tool groups (null for none), and its permission
 *  mode. Both are recorded for the id when asked for, so a resume is held to them too. */
function sessionLimits(deps: SpawnDeps, sessionId: string, options: SpawnClaudeOptions): { restrictedTo: readonly ToolGroup[] | null; permissionMode: string } {
  const restrictedTo = sessionGuiRestriction(sessionId, options.guiGroups);
  return { restrictedTo, permissionMode: sessionPermissionMode(sessionId, options.permissionMode) ?? deps.permissionMode };
}

export function createClaudeSpawner(deps: SpawnDeps) {
  // Spawn a fresh claude PTY for this session, register it, and wire its output /
  // exit back to the browser socket. `ws` may be null for a session spawned without
  // a viewer yet (e.g. spawnBackgroundChat) — output just buffers until a client
  // reattaches.
  function spawnClaudePty(sessionId: string, resume: string | null, ws: WebSocket | null, options: SpawnClaudeOptions = {}): PtyEntry {
    const { initialPrompt, cwd = CLAUDE_CWD, attachGuiMcp = true, draft, launch, customAgentId, directoryMcpGroups = [] } = options;
    const { restrictedTo, permissionMode } = sessionLimits(deps, sessionId, options);
    const fullGuiMcp = restrictedTo === null && carriesFullGuiMcp(attachGuiMcp, cwd, "claude");
    // fullGuiMcp picks the MCP mode (see buildClaudeArgs, and its own doc for who earns it): our
    // broker on one all-tools url; a project-directory cell gets none of ours and loads the GUI
    // tools its own directory registered. Either way the user's own MCP servers load.
    // Only --resume when the session has an on-disk transcript — claude doesn't write
    // a session's .jsonl until its first prompt, so a started-but-unused session can't
    // be resumed; we restart fresh (reusing the id via --session-id) instead.
    const canResume = resume !== null && sessionExistsOnDisk(resume, cwd);

    const { dir, resolved } = resolveSessionBackend({ cwd, sessionId, launch, canResume });
    const addDirs = sessionAddDirs(sessionId, dir.addDirs);
    const credential = sessionCredentialFor(deps, sessionId, resolved, customAgentId, canResume);

    const hookSettings = deps.hookSettingsJson("localhost", sessionId, credential.env);
    const mcpJson = deps.mcpConfigJson(sessionId, "127.0.0.1");
    // File-ized only when it is actually passed (fullGuiMcp), so a cell that never carries
    // the GUI MCP leaves no file behind for reap to clean up.
    // A restricted session is handed exactly its groups, so a resume has the tools the spawn had
    // whatever the worktree registered; the MCP routes serve nothing outside them either way.
    const handedGroups = restrictedTo ?? directoryMcpGroups;
    const directoryGroupsJson = handedGroups.length > 0 ? directoryGroupsMcpConfigJson({ sessionId, port: PORT, groups: handedGroups }) : null;
    // What this session is handed as --mcp-config, if anything: every tool, or the directory's groups.
    const handedMcpJson = fullGuiMcp ? mcpJson : directoryGroupsJson;
    const mcpConfig = handedMcpJson === null ? mcpJson : mcpConfigArgument(sessionId, handedMcpJson);
    const args = buildClaudeArgs({
      model: resolved.model,
      sessionId,
      resume,
      canResume,
      // A provider session's settings carry its token, as a rotated one's do, so they go to a 0600
      // file instead of argv — see session-settings.ts.
      settings: settingsArgument(sessionId, hookSettings, Object.keys(credential.env).length > 0),
      permissionMode,
      attachGuiMcp: fullGuiMcp || directoryGroupsJson !== null,
      mcpConfig,
      allowedTools: [claudeAllowedTools(deps, fullGuiMcp, restrictedTo), ...(options.extraAllowedTools ?? [])].filter(Boolean).join(","),
      addDirs,
      appendedPrompt: sessionAppendedPrompt(sessionId, cwd, dir.appendSystemPrompt),
    });

    console.log(`[ws] client connected (${canResume ? "resume" : "new"} ${sessionId})`);

    // Sandbox → run claude inside a fresh container (no tmux). Otherwise the host path:
    // a live tmux session for this id (survived a restart) reattaches; else create it.
    // The settings file is already on disk and may hold a provider token, so a failed
    // spawn has to take it with it — a session that never starts never reaches reap(),
    // where the cleanup normally happens (#579).
    const { entry, spawnedAtMs } = withSettingsCleanup(sessionId, spawnEntry);
    announceCredential(sessionId, entry.ws);

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
    function spawnEntry(): StartedAgentPty {
      const reattaching = ptyWouldReattach(sessionId, true);
      if (!reattaching) resetSessionToolGroups(sessionId);
      // Only a NEW process is on the chosen token; a reattached one keeps the token it started with.
      if (!reattaching) rememberTokenSession(sessionId, credential.tokenId);
      if (!reattaching) printMovedNotice(sessionId, ws, credential.tokenId);
      return spawnWithFullGuiClaim({ sessionId, attachGuiMcp, cwd, wouldReattach: reattaching, agent: "claude", restricted: restrictedTo !== null }, () => {
        const program = sessionProgram(deps.claudeBin, sessionId, customAgentId, canResume ? resume : null, credential.unset, permissionMode);
        const spawnEnv = { ...program.spawnEnv, env: { ...program.spawnEnv.env, ...claudeRendererEnv(sessionId, cwd) } };
        // "claude" whatever wrapper started it — see sessionProgram.
        return startAgentPty({ sessionId, ws, cwd, agent: "claude", file: program.file, args: [...program.prefixArgs, ...args], spawnEnv, note: program.note });
      });
    }
    // Every claude spawn above carries `--settings` with the Pre/PostToolUse hooks, so from here
    // on this session reports its own tool calls — which is what stops the MCP broker recording
    // its GUI calls a second time (mcp/gui-call-history.ts).
    hookedSessions.add(sessionId);

    if (!canResume) {
      // Brand-new (or restarted-idle) session: surface it in the sidebar before it's persisted.
      knownSessions.set(sessionId, { createdAt: Date.now(), title: newSessionTitle(initialPrompt ?? draft) });
      deps.publishSessionCreated(sessionId);
    }

    // The auto-run prompt / editable draft is typed into the input box once ready (see
    // attachDraftInjection) — its scanner is fed the pty output below. The submit byte(s)
    // are resolved per send, the same live config read and agent scoping the phone's submit
    // uses (index.ts) — an `esc-cr` host submits on ESC+CR, so a hardcoded CR would land as a
    // newline and the prompt would never run (#1148).
    const scanForDraftReady = attachDraftInjection(entry, initialPrompt, draft, () => submitSequenceForAgent(entry.agent, getTerminalSubmit()));

    // PTY -> browser (buffering a tail for reattach, batching the frames).
    const output = wireBufferedOutput(entry, deps.outputBufferLimit, scanForDraftReady);

    entry.term.onExit(({ exitCode, signal }) => {
      const lifetimeMs = Date.now() - spawnedAtMs;
      console.log(ptyExitLine({ agent: "claude", exitCode, signal, lifetimeMs, cwd, sessionId }));
      output.flush(); // a queued batch must not arrive after the exit frame
      // Clear the dot if it died mid-turn, then tear down everything (deletes
      // ptys/knownSessions/activity and publishes "closed") so a process that
      // exits on its own — e.g. a brand-new session that never persisted —
      // doesn't linger in the sidebar.
      // Only for the CURRENT pty: a restart's replacement may already hold this id.
      if (isCurrentPty(sessionId, entry)) deps.setWorking(sessionId, false);
      // Not always a reap: under tmux this pty is the CLIENT, and one killed from outside leaves
      // the session running (#1496). reportPtyExit asks tmux which of the two just happened.
      reportPtyExit(sessionId, entry, { exitCode, signal, lifetimeMs }, deps.reap);
    });

    return entry;
  }

  return { spawnClaudePty };
}
