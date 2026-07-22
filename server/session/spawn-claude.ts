// Starting a claude session in a PTY and wiring it to the browser. The most entangled
// piece of index.ts (#548 step 3c): it spans the sandbox decision, the CLI args, the
// sidebar's optimistic row, the draft typed into the input box, and teardown on exit.
import type { WebSocket } from "ws";
import { CLAUDE_CWD } from "../config/env.js";
import { getUserMcpServers } from "../config/config-routes.js";
import { SANDBOX_HOST } from "../infra/sandbox.js";
import { buildClaudeArgs } from "../agents/claude-args.js";
import { knownSessions, ptys } from "./registry.js";
import { ptySpawn, sandboxWouldRun, spawnSandboxEntry } from "./pty-spawn.js";
import { attachDraftInjection } from "./draft-injection.js";
import { sendExitAndClose, sendFrame } from "./ws-frames.js";
import { appendBoundedOutput } from "./terminal-replay.js";
import { sessionExistsOnDisk } from "./session-reads.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";
import { loadDirConfig } from "../config/dir-config.js";
import { getProviders } from "../config/config-routes.js";
import { resolveProvider } from "./provider-env.js";
import { settingsArgument } from "./session-settings.js";

export function createClaudeSpawner(deps: SpawnDeps) {
  // Spawn a fresh claude PTY for this session, register it, and wire its output /
  // exit back to the browser socket. `ws` may be null for a session spawned without
  // a viewer yet (e.g. spawnBackgroundChat) — output just buffers until a client
  // reattaches. `initialPrompt`, when given, is passed to claude as the first turn
  // so the session starts working immediately, before anyone opens it. `draft` is the
  // opposite: it is NOT auto-submitted — once claude's UI is ready the text is typed
  // into the input box (no Enter) so the user can review / edit / send it. Pass one or
  // the other, never both.
  function spawnClaudePty(
    sessionId: string,
    resume: string | null,
    ws: WebSocket | null,
    initialPrompt?: string,
    cwd: string = CLAUDE_CWD,
    attachGuiMcp: boolean = true,
    draft?: string,
  ): PtyEntry {
    // attachGuiMcp picks the MCP mode (see buildClaudeArgs): the single view (default)
    // attaches the GUI MCP + --strict-mcp-config (main's classic behavior); the grid's
    // dev terminals attach neither, so the user's + project's MCP servers load normally.
    // Only --resume when the session has an on-disk transcript — claude doesn't write
    // a session's .jsonl until its first prompt, so a started-but-unused session can't
    // be resumed; we restart fresh (reusing the id via --session-id) instead.
    // Sandbox only the SINGLE-VIEW interactive session: attachGuiMcp=true excludes grid
    // dev terminals (?gui=0), and ws!==null excludes hidden background/translation workers.
    // Falls back to the host spawn if the Docker daemon isn't reachable.
    const sandbox = sandboxWouldRun(attachGuiMcp) && ws !== null;
    const canResume = resume !== null && sessionExistsOnDisk(resume, cwd);

    // What this directory asked its sessions to run (#579). A refusal is NOT applied —
    // the session stays on Anthropic, which is the safe outcome — but it is logged loudly,
    // because silently ignoring the directory's choice is its own kind of surprise.
    const dir = loadDirConfig(cwd);
    const choice = resolveProvider({ provider: dir.provider, model: dir.model }, getProviders(), process.env, sandbox);
    if (!choice.ok) console.warn(`[provider] ${cwd}: ${choice.reason} — staying on Anthropic`);
    const resolved = choice.ok ? choice.value : { model: null, env: {}, unset: [] };

    const hookSettings = deps.hookSettingsJson(sandbox ? SANDBOX_HOST : "localhost", sessionId, resolved.env);
    const args = buildClaudeArgs({
      model: resolved.model,
      sessionId,
      resume,
      canResume,
      // In the sandbox the hooks + GUI MCP are reached over host.docker.internal. A
      // provider session's settings carry its token, so they go to a 0600 file instead of
      // argv — see session-settings.ts.
      settings: settingsArgument(sessionId, hookSettings, Object.keys(resolved.env).length > 0),
      permissionMode: deps.permissionMode,
      attachGuiMcp,
      mcpConfig: deps.mcpConfigJson(sessionId, sandbox ? SANDBOX_HOST : "127.0.0.1", sandbox),
      // Auto-allow the GUI tools + the user's own configured MCP servers (mcp__<id>), so
      // their tools don't trip a permission prompt on every call.
      guiMcpTools: [deps.guiMcpTools, ...getUserMcpServers().map((s) => `mcp__${s.id}`)].join(","),
    });

    console.log(`[ws] client connected (${canResume ? "resume" : "new"} ${sessionId})`);

    // Sandbox → run claude inside a fresh container (no tmux). Otherwise the host path:
    // a live tmux session for this id (survived a restart) reattaches; else create it.
    let entry: PtyEntry;
    if (sandbox) {
      entry = spawnSandboxEntry(sessionId, args, cwd, ws);
    } else {
      const { term, tmux } = ptySpawn(sessionId, deps.claudeBin, args, cwd, true);
      console.log(`[pty] spawned claude (pid=${term.pid}${tmux ? " via tmux" : ""}) in ${cwd}`);
      entry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "claude" };
    }
    ptys.set(sessionId, entry);

    if (!canResume) {
      // Brand-new (or restarted-idle) session: surface it in the sidebar before
      // it's persisted. A spawned session (initialPrompt or a draft) gets a title from
      // that text so it's recognizable in the sidebar before anyone opens it.
      const seed = initialPrompt ?? draft;
      const title = seed ? seed.replace(/\s+/g, " ").trim().slice(0, 60) || "New session" : "New session";
      knownSessions.set(sessionId, { createdAt: Date.now(), title });
      deps.publishSessionCreated(sessionId);
    }

    // The auto-run prompt / editable draft is typed into the input box once ready (see
    // attachDraftInjection) — its scanner is fed the pty output below.
    const scanForDraftReady = attachDraftInjection(entry, initialPrompt, draft);

    // PTY -> browser (buffering a bounded tail for reattach).
    entry.term.onData((data) => {
      entry.buffer = appendBoundedOutput(entry.buffer, data, deps.outputBufferLimit);
      sendFrame(entry.ws, { type: "output", data });
      scanForDraftReady(data);
    });

    entry.term.onExit(({ exitCode, signal }) => {
      console.log(`[pty] exited code=${exitCode} signal=${signal}`);
      sendExitAndClose(entry.ws, exitCode, signal);
      // Clear the dot if it died mid-turn, then tear down everything (deletes
      // ptys/knownSessions/activity and publishes "closed") so a process that
      // exits on its own — e.g. a brand-new session that never persisted —
      // doesn't linger in the sidebar.
      deps.setWorking(sessionId, false);
      deps.reap(sessionId);
    });

    return entry;
  }

  return { spawnClaudePty };
}
