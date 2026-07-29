// Starting an Antigravity (`agy`) session in a PTY. Like codex, agy mints its conversation id
// itself, so a fresh session is watched until that id appears — that is what lets a later cold
// reconnect resume it.
import type { WebSocket } from "ws";
import { PORT } from "../config/env.js";
import type { ToolGroup } from "../../common/toolGroups.js";
import { guiMcpEnv } from "./mcp-config.js";
import { buildAntigravityArgs } from "../agents/antigravity-args.js";
import { syncAntigravityMcpConfig } from "../agents/antigravity-mcp.js";
import { antigravityBrainRoot, snapshotAntigravitySessions, watchForAntigravitySession } from "../agents/antigravity-session.js";
import { ptySpawn } from "./pty-spawn.js";
import { wireAgentPtyRelay } from "./pty-relay.js";
import { antigravityConversationIds, claimedAntigravityConversations, ptys } from "./registry.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";

export function createAntigravitySpawner(deps: SpawnDeps) {
  function rememberAntigravityConversation(sessionId: string, root: string, before: ReadonlySet<string>): void {
    watchForAntigravitySession(root, before, { claimed: claimedAntigravityConversations, isCancelled: () => !ptys.has(sessionId) })
      .then((id) => {
        if (!id) return;
        claimedAntigravityConversations.add(id);
        antigravityConversationIds.set(sessionId, id);
        console.log(`[pty] captured antigravity conversation ${id} for session ${sessionId}`);
      })
      .catch(() => {});
  }

  function spawnAntigravityPty(
    sessionId: string,
    ws: WebSocket | null,
    resumeConversationId: string | null,
    cwd: string,
    options: {
      /** The tool groups this cell's DIRECTORY has registered, read by the caller (the lookup
       *  reads Claude Code's config files, and this is sync). agy reads its MCP servers from a
       *  file in the directory rather than from a flag, so that file is brought in line with them
       *  here, on the way past: a directory whose switches were flipped before this shipped — or
       *  with the `claude mcp` CLI directly — needs no second action to work. */
      mcpGroups?: readonly ToolGroup[];
      /** Run this as the session's first turn (a collection action, a background chat). */
      initialPrompt?: string | null;
    } = {},
  ): PtyEntry {
    const { mcpGroups = [], initialPrompt = null } = options;
    syncAntigravityMcpConfig(cwd, mcpGroups);
    const root = antigravityBrainRoot();
    const before = snapshotAntigravitySessions(root);

    const args = buildAntigravityArgs({ resume: resumeConversationId, model: deps.antigravityModel, skipPermissions: true, initialPrompt });
    // The session id reaches the GUI MCP bridge through this environment and nowhere else — the
    // config file agy reads is shared by every session in the directory (see antigravity-mcp.ts).
    const { term, tmux } = ptySpawn(sessionId, deps.antigravityBin, args, cwd, true, { env: guiMcpEnv(sessionId, PORT) });
    const via = tmux ? " via tmux" : "";
    const resumeNote = resumeConversationId ? ` (resume ${resumeConversationId})` : "";
    console.log(`[pty] spawned antigravity (pid=${term.pid}${via}) in ${cwd}${resumeNote}`);

    const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "antigravity" };
    ptys.set(sessionId, entry);

    if (resumeConversationId) {
      antigravityConversationIds.set(sessionId, resumeConversationId);
    } else {
      // Only for a FRESH session: on resume the id is already known, and running the watcher could
      // overwrite it with a mis-attributed concurrent conversation.
      rememberAntigravityConversation(sessionId, root, before);
    }

    wireAgentPtyRelay(entry, sessionId, deps);
    return entry;
  }

  return { spawnAntigravityPty };
}
