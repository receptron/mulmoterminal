// Starting a Cursor CLI session in a PTY.
//
// As short as copilot's, and for the same two reasons:
//
//   ONE FLAG FOR NEW AND RESUME. `--resume <uuid>` starts a chat under an id we choose and later
//   returns to it, so there is no watcher, no `claimed…` set, no conversation map and no resume
//   branch. Measured against 2026.09.10-fd3934a: a uuid this server invented — never passed to
//   `create-chat` — starts a new chat and comes back as the `conversation_id` on every hook of that
//   session. `create-chat` exists and is not needed.
//
//   HOOKS, NOT A TAIL. cursor reports its own turns the way claude does. Where it differs is WHERE
//   the hooks are registered: machine-globally, once, rather than per spawn — cursor-hooks-file.ts
//   has the measurements, including why the per-spawn `--plugin-dir` cannot be used for this.
//
//   GUI MCP THROUGH THE DIRECTORY, LIKE agy AND grok. Cursor reads MCP servers from
//   `.cursor/mcp.json` in the working directory and takes no per-spawn flag, so the registration is
//   written there before the spawn (cursor-mcp.ts) — by the ROUTE rather than here, because half of
//   it is an awaited `cursor-agent mcp enable`. What this spawn owes that file is the SESSION: the
//   id reaches the stdio bridge through the cursor process's environment (guiMcpEnv) and nowhere
//   else, because a file shared by every session in the directory cannot carry one.
import type { WebSocket } from "ws";
import { PORT } from "../config/env.js";
import { guiMcpEnv } from "./mcp-config.js";
import { buildCursorArgs } from "../agents/cursor-args.js";
import { cursorAdapter } from "../agents/cursor.js";
import { syncCursorHooksFile } from "../agents/cursor-hooks-file.js";
import { ptys } from "./registry.js";
import { entitledToolGroups, rememberEntitledToolGroups } from "./bridge-session.js";
import type { ToolGroup } from "../../common/toolGroups.js";
import { ptySpawn, ptyWouldReattach } from "./pty-spawn.js";
import { ptyStartLine } from "./pty-exit-log.js";
import { wireAgentPtyRelay } from "./pty-relay.js";
import { seedPromptArgument, withSettingsCleanup } from "./session-settings.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";

export function createCursorSpawner(deps: SpawnDeps) {
  function spawnCursorPty(
    sessionId: string,
    ws: WebSocket | null,
    // Positional for symmetry with the other spawners, and unused: `--resume` returns to the same
    // id it creates, so a resume needs nothing the fresh path does not already pass.
    _resumeId: string | null,
    cwd: string,
    options: { initialPrompt?: string | null; mcpGroups?: readonly ToolGroup[] } = {},
  ): PtyEntry {
    const { initialPrompt = null, mcpGroups = [] } = options;
    // What the bridge is allowed to serve this session, recorded the way muse records it and for
    // muse's reason: cursor's MCP server is started with a curated environment, so it asks this
    // server which session it belongs to and is told these groups with the answer. The file in the
    // directory cannot answer it — it is shared by every cursor session running there.
    //
    // Re-recorded on a reattach only when nothing is on file: a server restart forgets the map
    // while the tmux pane lives on, and that session's bridge would otherwise be entitled to
    // nothing (the shape spawn-muse.ts arrived at).
    if (!ptyWouldReattach(sessionId, true) || entitledToolGroups(sessionId).length === 0) rememberEntitledToolGroups(sessionId, mcpGroups);
    // Every spawn, not only at boot: the file is one the user can delete, and rewriting it costs a
    // read when it already matches (see syncCursorHooksFile).
    syncCursorHooksFile(PORT);

    // A seed this agent takes as an ARGUMENT cannot carry a newline on Windows, so it may travel in
    // a file with the command line naming it instead (#1518, session-settings.ts).
    const seed = initialPrompt === null ? null : seedPromptArgument(sessionId, initialPrompt);
    const args = buildCursorArgs({ sessionId, model: deps.cursorModel, initialPrompt: seed });

    // A spawn that throws never reaches reap(), where the seed file is normally cleaned up — the
    // same guarantee spawn-claude takes for its settings file (#579, #1518).
    const { entry, spawnedAtMs } = withSettingsCleanup(sessionId, () => {
      const { term, tmux, reattached } = ptySpawn(sessionId, deps.cursorBin, args, cwd, true, {
        env: guiMcpEnv(sessionId, PORT),
        binEnvVar: cursorAdapter.binEnvVar,
      });
      const at = Date.now();
      console.log(ptyStartLine({ agent: "cursor", pid: term.pid, cwd, tmux, reattached, sessionId, note: null }));
      const created: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "cursor" };
      ptys.set(sessionId, created);
      return { entry: created, spawnedAtMs: at };
    });

    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps);
    return entry;
  }

  return { spawnCursorPty };
}
