import type { WebSocket } from "ws";
import { PORT } from "../config/env.js";
import { guiMcpEnv } from "./mcp-config.js";
import { buildAntigravityArgs } from "../agents/antigravity-args.js";
import { antigravityBrainRoot, ensureAntigravityMcpConfig, snapshotAntigravitySessions, watchForAntigravitySession } from "../agents/antigravity-session.js";
import { ptySpawn } from "./pty-spawn.js";
import { antigravityConversationIds, claimedAntigravityConversations, ptys } from "./registry.js";
import { sendExitAndClose, sendFrame } from "./ws-frames.js";
import { appendBoundedOutput } from "./terminal-replay.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";

export function createAntigravitySpawner(deps: SpawnDeps) {
  function wireAntigravityRelay(entry: PtyEntry, sessionId: string): void {
    entry.term.onData((data) => {
      entry.buffer = appendBoundedOutput(entry.buffer, data, deps.outputBufferLimit);
      sendFrame(entry.ws, { type: "output", data });
    });
    entry.term.onExit(({ exitCode, signal }) => {
      console.log(`[pty] antigravity exited code=${exitCode} signal=${signal}`);
      sendExitAndClose(entry.ws, exitCode, signal);
      deps.reap(sessionId);
    });
  }

  function rememberAntigravitySession(sessionId: string, root: string, before: Set<string>): void {
    watchForAntigravitySession(root, before, { claimed: claimedAntigravityConversations, isCancelled: () => !ptys.has(sessionId) })
      .then((meta) => {
        if (!meta) return;
        claimedAntigravityConversations.add(meta.id);
        antigravityConversationIds.set(sessionId, meta.id);
        console.log(`[pty] captured antigravity conversation ID ${meta.id} for session ${sessionId}`);
      })
      .catch(() => {});
  }

  function spawnAntigravityPty(
    sessionId: string,
    ws: WebSocket | null,
    resumeConversationId: string | null,
    cwd: string,
    options: {
      initialPrompt?: string | null;
    } = {},
  ): PtyEntry {
    ensureAntigravityMcpConfig();
    const root = antigravityBrainRoot();
    const before = snapshotAntigravitySessions(root);

    const args = buildAntigravityArgs({
      resume: resumeConversationId,
      model: deps.antigravityModel,
      skipPermissions: true,
    });
    const { term, tmux } = ptySpawn(sessionId, deps.antigravityBin, args, cwd, true, { env: guiMcpEnv(sessionId, PORT) });
    const via = tmux ? " via tmux" : "";
    const resumeNote = resumeConversationId ? ` (resume ${resumeConversationId})` : "";
    console.log(`[pty] spawned antigravity (pid=${term.pid}${via}) in ${cwd}${resumeNote}`);

    const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "antigravity" };
    ptys.set(sessionId, entry);

    if (resumeConversationId) {
      antigravityConversationIds.set(sessionId, resumeConversationId);
    } else {
      rememberAntigravitySession(sessionId, root, before);
    }

    wireAntigravityRelay(entry, sessionId);
    return entry;
  }

  return { spawnAntigravityPty };
}
