// Starting a codex session in a PTY. Unlike claude, codex mints its rollout id only after
// the first turn, so a fresh session is watched until that id appears — that is what lets
// a later cold reconnect resume it. Split from index.ts (#548 step 3c).
import type { WebSocket } from "ws";
import { PORT } from "../config/env.js";
import { buildCodexArgs } from "../agents/codex-args.js";
import { codexSessionsRoot, snapshotSessions, watchForCodexSession } from "../agents/codex-session.js";
import { claimedCodexRollouts, codexRolloutIds, ptys } from "./registry.js";
import { ptySpawn } from "./pty-spawn.js";
import { attachCodexAutoRun } from "./draft-injection.js";
import { sendExitAndClose, sendFrame } from "./ws-frames.js";
import { appendBoundedOutput } from "./terminal-replay.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";

export function createCodexSpawner(deps: SpawnDeps) {
  function wireCodexRelay(entry: PtyEntry, sessionId: string, onOutput?: (data: string) => void): void {
    entry.term.onData((data) => {
      entry.buffer = appendBoundedOutput(entry.buffer, data, deps.outputBufferLimit);
      sendFrame(entry.ws, { type: "output", data });
      onOutput?.(data);
    });
    entry.term.onExit(({ exitCode, signal }) => {
      console.log(`[pty] codex exited code=${exitCode} signal=${signal}`);
      sendExitAndClose(entry.ws, exitCode, signal);
      deps.reap(sessionId);
    });
  }

  // codex persists its rollout only after the first user turn, so watch a FRESH session's lifetime
  // (stop once its pty is gone) and capture the minted id so a later cold reconnect can
  // `codex resume <id>`. Attribution is unambiguous-only (see pickFreshSession).
  function rememberCodexRollout(sessionId: string, root: string, before: Set<string>, cwd: string): void {
    watchForCodexSession(root, before, { cwd, claimed: claimedCodexRollouts, isCancelled: () => !ptys.has(sessionId) })
      .then((meta) => {
        if (!meta) return;
        claimedCodexRollouts.add(meta.file);
        codexRolloutIds.set(sessionId, meta.id);
      })
      .catch(() => {});
  }

  function spawnCodexPty(
    sessionId: string,
    ws: WebSocket | null,
    resumeRolloutId: string | null,
    cwd: string,
    attachGuiMcp: boolean,
    initialPrompt: string | null,
  ): PtyEntry {
    const root = codexSessionsRoot();
    const before = snapshotSessions(root);
    // Single view: point codex at the in-process GUI MCP (same per-session URL as claude's) so it
    // can drive the GUI panel. Grid dev terminals pass gui=0 → no MCP.
    const guiMcpUrl = attachGuiMcp ? `http://127.0.0.1:${PORT}/api/mcp/${sessionId}` : null;
    const args = buildCodexArgs({ resume: resumeRolloutId, model: deps.codexModel, guiMcpUrl });
    const { term, tmux } = ptySpawn(sessionId, deps.codexBin, args, cwd, true);
    const via = tmux ? " via tmux" : "";
    const resumeNote = resumeRolloutId ? ` (resume ${resumeRolloutId})` : "";
    console.log(`[pty] spawned codex (pid=${term.pid}${via}) in ${cwd}${resumeNote}`);
    const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "codex" };
    ptys.set(sessionId, entry);
    if (resumeRolloutId) {
      codexRolloutIds.set(sessionId, resumeRolloutId);
    } else {
      // Discover the id only for a FRESH session. On resume we already know it; running the watcher
      // could overwrite the known id with a mis-attributed concurrent rollout.
      rememberCodexRollout(sessionId, root, before, cwd);
    }
    // A seed prompt is typed into codex's input box after it settles (not a CLI arg — see
    // attachCodexAutoRun), so a long collection-action prompt can't overflow tmux's command limit.
    const autoRun = initialPrompt ? attachCodexAutoRun(entry, initialPrompt) : undefined;
    wireCodexRelay(entry, sessionId, autoRun);
    return entry;
  }

  return { spawnCodexPty };
}
