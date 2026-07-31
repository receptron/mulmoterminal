// Starting a codex session in a PTY. Unlike claude, codex mints its rollout id only after
// the first turn, so a fresh session is watched until that id appears — that is what lets
// a later cold reconnect resume it. Split from index.ts (#548 step 3c).
import type { WebSocket } from "ws";
import { PORT } from "../config/env.js";
import { buildCodexArgs } from "../agents/codex-args.js";
import { codexAdapter } from "../agents/codex.js";
import type { ToolGroup } from "../../common/toolGroups.js";
import { codexGuiMcpServers } from "./mcp-config.js";
import { codexSessionsRoot, snapshotSessions, watchForCodexSession } from "../agents/codex-session.js";
import { codexRolloutPath } from "../agents/codex-sessions.js";
import { trackCodexActivity } from "./codex-activity-track.js";
import { claimedCodexRollouts, codexRolloutIds, ptys } from "./registry.js";
import { ptySpawn } from "./pty-spawn.js";
import { ptyStartLine } from "./pty-exit-log.js";
import { wireAgentPtyRelay } from "./pty-relay.js";
import { attachCodexAutoRun } from "./draft-injection.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";

// Bound to ONE pty: `ptys.has(id)` would keep a stale tail alive after a reap-then-
// respawn under the same id, and both tails would report the same boundaries.
const activityDepsFor = (sessionId: string, entry: PtyEntry, deps: SpawnDeps) => ({
  setWorking: deps.setWorking,
  setWaiting: deps.setWaiting,
  isActive: () => ptys.get(sessionId)?.active ?? false,
  uiPort: deps.uiPort,
  isAlive: () => ptys.get(sessionId) === entry,
});

export function createCodexSpawner(deps: SpawnDeps) {
  // codex persists its rollout only after the first user turn, so watch a FRESH session's lifetime
  // (stop once its pty is gone) and capture the minted id so a later cold reconnect can
  // `codex resume <id>`. Attribution is unambiguous-only (see pickFreshSession).
  function rememberCodexRollout(sessionId: string, entry: PtyEntry, root: string, before: Set<string>, cwd: string): void {
    watchForCodexSession(root, before, { cwd, claimed: claimedCodexRollouts, isCancelled: () => !ptys.has(sessionId) })
      .then((meta) => {
        if (!meta) return;
        claimedCodexRollouts.add(meta.file);
        codexRolloutIds.set(sessionId, meta.id);
        // A rollout only discovered now is one this session just created, so it is read
        // whole: its first turn is in there and hasn't been reported yet.
        trackCodexActivity(sessionId, meta.file, false, activityDepsFor(sessionId, entry, deps));
      })
      .catch(() => {});
  }

  function spawnCodexPty(
    sessionId: string,
    ws: WebSocket | null,
    resumeRolloutId: string | null,
    cwd: string,
    attachGuiMcp: boolean,
    // The two things only some callers have. An object rather than two more positional
    // arguments: seven of those is past the point where a call site can be read.
    options: {
      /** Typed into codex's input box once it settles, for a session started to run something. */
      initialPrompt?: string | null;
      /** The tool groups this cell's DIRECTORY has registered, for a grid cell (gui=0). Read by
       *  the caller because the lookup reads Claude Code's config files, and this is sync. */
      mcpGroups?: readonly ToolGroup[];
    } = {},
  ): PtyEntry {
    const { initialPrompt = null, mcpGroups = [] } = options;
    const root = codexSessionsRoot();
    const before = snapshotSessions(root);
    // Two surfaces, the same two claude has:
    //   single view (gui) — the whole GUI MCP on one per-session URL.
    //   grid cell (gui=0) — one URL per tool group the DIRECTORY registered, which the caller
    //     read from the same config claude's own switches write (see the launcher's Canvas
    //     rows). codex cannot read that config itself, so the groups arrive resolved here.
    // A grid cell whose directory registered nothing gets no MCP at all, exactly as before.
    //
    // DELIBERATELY not given claude's workspace-cwd rule (carriesFullGuiMcp, PR2): a codex cell in
    // the workspace stays on its directory's registered groups. That rule exists to make a
    // workspace cell equivalent to the SINGLE VIEW so the single view can be deleted, and the
    // single view only ever ran claude — so there is no codex behaviour it would be preserving,
    // and applying it would be a new capability rather than a migrated one. Revisit if a reason
    // turns up; it is one call to carriesFullGuiMcp with `cwd`.
    const guiMcpServers = codexGuiMcpServers({ sessionId, port: PORT, groups: mcpGroups, allTools: attachGuiMcp });
    const args = buildCodexArgs({ resume: resumeRolloutId, model: deps.codexModel, guiMcpServers });
    const { term, tmux, reattached } = ptySpawn(sessionId, deps.codexBin, args, cwd, true, { binEnvVar: codexAdapter.binEnvVar });
    const spawnedAtMs = Date.now();
    const note = resumeRolloutId ? `resume ${resumeRolloutId}` : null;
    console.log(ptyStartLine({ agent: "codex", pid: term.pid, cwd, tmux, reattached, sessionId, note }));
    const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "codex" };
    ptys.set(sessionId, entry);
    if (resumeRolloutId) {
      codexRolloutIds.set(sessionId, resumeRolloutId);
      const file = codexRolloutPath(root, resumeRolloutId);
      if (file) trackCodexActivity(sessionId, file, true, activityDepsFor(sessionId, entry, deps));
    } else {
      // Discover the id only for a FRESH session. On resume we already know it; running the watcher
      // could overwrite the known id with a mis-attributed concurrent rollout.
      rememberCodexRollout(sessionId, entry, root, before, cwd);
    }
    // A seed prompt is typed into codex's input box after it settles (not a CLI arg — see
    // attachCodexAutoRun), so a long collection-action prompt can't overflow tmux's command limit.
    const autoRun = initialPrompt ? attachCodexAutoRun(entry, initialPrompt) : undefined;
    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps, autoRun);
    return entry;
  }

  return { spawnCodexPty };
}
