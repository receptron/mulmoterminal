// Starting a codex session in a PTY. Unlike claude, codex mints its rollout id only after
// the first turn, so a fresh session is watched until that id appears — that is what lets
// a later cold reconnect resume it. Split from index.ts (#548 step 3c).
import type { WebSocket } from "ws";
import { PORT } from "../../../config/env.js";
import { buildCodexArgs } from "../../../agents/codex/codex-args.js";
import { codexAdapter } from "../../../agents/codex/codex.js";
import type { ToolGroup } from "../../../../common/toolGroups.js";
import { codexGuiMcpServers, guiMcpEnv } from "../setup/mcp-config.js";
import { wantsCodexPermissionHook } from "../../../agents/codex/codex-hook.js";
import { readSessionMeta, snapshotSessions, watchForCodexSession } from "../../../agents/codex/codex-session.js";
import { findOpenCodexRollout } from "./codex-open-rollout-recovery.js";
import { accountSpawnEnv, codexSessionRoot, codexSessionSkillsDir } from "../../session-home.js";
import { codexRolloutPath } from "../../../agents/codex/codex-sessions.js";
import { trackCodexActivity } from "../../activity/codex-activity-track.js";
import { claimedCodexRollouts, codexRollouts, ptys, rememberCodexRollout } from "../../registry.js";
import { ptyWouldReattach } from "../../pty/pty-spawn.js";
import { startAgentPty } from "../../pty/agent-pty-start.js";
import { spawnWithFullGuiClaim, type FullGuiClaimRequest } from "../spawn-with-full-gui-claim.js";
import { codexSessionGuiRestriction } from "./session-gui-restriction.js";
import { wireAgentPtyRelay } from "../../pty/pty-relay.js";
import { attachCodexAutoRun } from "../draft-injection.js";
import type { PtyEntry } from "../../types.js";
import type { SpawnDeps } from "../spawn-deps.js";
import { refreshCodexSkillsMirror } from "../../../backends/workspaceSetup.js";

// Bound to ONE pty: `ptys.has(id)` would keep a stale tail alive after a reap-then-
// respawn under the same id, and both tails would report the same boundaries.
const activityDepsFor = (sessionId: string, entry: PtyEntry, deps: SpawnDeps) => ({
  setWorking: deps.setWorking,
  setWaiting: deps.setWaiting,
  isActive: () => ptys.get(sessionId)?.active ?? false,
  publishPromptSubmitted: deps.publishPromptSubmitted,
  uiPort: deps.uiPort,
  isAlive: () => ptys.get(sessionId) === entry,
});

// codex persists its rollout only after the first user turn, so watch a FRESH session's lifetime
// (stop once ITS pty is gone — the watch has no deadline, so a respawn under the same id must not
// keep it alive) and capture the minted id so a later cold reconnect can
// `codex resume <id>`. Attribution is unambiguous-only (see pickFreshSession).
function captureCodexRollout(deps: SpawnDeps, sessionId: string, entry: PtyEntry, root: string, before: Set<string>, cwd: string): void {
  watchForCodexSession(root, before, { cwd, claimed: claimedCodexRollouts, isCancelled: () => ptys.get(sessionId) !== entry })
    .then((meta) => {
      if (!meta) return;
      claimedCodexRollouts.add(meta.file);
      rememberCodexRollout(sessionId, meta.id, cwd);
      // A rollout only discovered now is one this session just created, so it is read
      // whole: its first turn is in there and hasn't been reported yet.
      trackCodexActivity(sessionId, meta.file, { startAtEnd: false }, activityDepsFor(sessionId, entry, deps));
    })
    .catch(() => {});
}

// A survivor whose mapping is gone (#3283) is writing a rollout that predates the snapshot, so the
// appear-watcher can never see it. The file its processes hold open for writing is the evidence.
// One that existed before the snapshot is tailed from the end like a mapped reattach, so no finished
// turn is announced again; one created since is its first turn, read whole as the watcher would.
// With no single open rollout — no first turn yet, or ambiguous — the appear-watcher runs as before.
async function adoptOpenRollout(deps: SpawnDeps, sessionId: string, entry: PtyEntry, root: string, before: Set<string>, cwd: string): Promise<boolean> {
  const file = await findOpenCodexRollout(sessionId, root, claimedCodexRollouts);
  const meta = file === null ? null : await readSessionMeta(file);
  // Re-checked after the awaits: the pty may have ended, or a watcher claimed the file meanwhile.
  if (file === null || meta === null || ptys.get(sessionId) !== entry || claimedCodexRollouts.has(file)) return false;
  if (mappedElsewhere(sessionId, meta.id)) return false;
  claimedCodexRollouts.add(file);
  rememberCodexRollout(sessionId, meta.id, cwd);
  const mode = before.has(file) ? { startAtEnd: true, restoreOpenTurn: true } : { startAtEnd: false };
  trackCodexActivity(sessionId, file, mode, activityDepsFor(sessionId, entry, deps));
  return true;
}

// Paths are claimed only by this process; the log also knows conversations other cells resumed.
const mappedElsewhere = (sessionId: string, conversationId: string): boolean =>
  [...codexRollouts.values()].some((record) => record.conversationId === conversationId && record.sessionId !== sessionId);

function recoverUnmappedRollout(deps: SpawnDeps, sessionId: string, entry: PtyEntry, root: string, before: Set<string>, cwd: string): void {
  void adoptOpenRollout(deps, sessionId, entry, root, before, cwd)
    .catch(() => false)
    .then((adopted) => {
      if (!adopted) captureCodexRollout(deps, sessionId, entry, root, before, cwd);
    });
}

export function createCodexSpawner(deps: SpawnDeps) {
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
      /** Limit this session to these GUI tool groups, for this spawn and every later one (#3033). */
      guiGroups?: readonly ToolGroup[] | undefined;
    } = {},
  ): PtyEntry {
    const { initialPrompt = null, mcpGroups = [], guiGroups } = options;
    const restrictedTo = codexSessionGuiRestriction(sessionId, guiGroups, resumeRolloutId);
    // codex reads skills from its mirror (~/.codex/skills), not from the workspace's own
    // `.claude/skills`, and the mirror is otherwise refreshed only at boot — so a skill created
    // mid-run (a new collection) would stay invisible to codex until a restart. No-op outside
    // the managed workspace.
    // Into the home this session runs on (#2215): a codex cell on a second login reads THAT home.
    refreshCodexSkillsMirror(cwd, codexSessionSkillsDir(sessionId));
    const root = codexSessionRoot(sessionId);
    const before = snapshotSessions(root);
    // Two surfaces, the same two claude has:
    //   single view (gui) — the whole GUI MCP on one per-session URL.
    //   grid cell (gui=0) — one URL per tool group the DIRECTORY registered, which the caller
    //     read from the same config claude's own switches write (see the launcher's Canvas
    //     rows). codex cannot read that config itself, so the groups arrive resolved here.
    // A grid cell whose directory registered nothing gets no MCP at all, exactly as before.
    //
    // The workspace-cwd rule APPLIES here, and it did not use to. It was withheld on the grounds
    // that it exists to make a workspace cell equivalent to the single view, and the single view
    // only ever ran claude — so extending it to codex was a new capability rather than a migrated
    // one. The owner's call (2026-08-03) is that the workspace cell is agent-agnostic: two cells in
    // the same directory differing only by which agent runs in them should not differ in what the
    // agent can reach. So a codex session in the workspace gets the whole GUI MCP, as claude's does.
    //
    // It is a real widening, because codex approves per SERVER: everything on that URL is waved
    // through at once — the external accounts (google, X), the paid generation, and
    // spawnBackgroundChat, which belongs to no group and is therefore reachable ONLY this way. All
    // of it was already auto-allowed for claude in the same cell, which is the asymmetry this
    // closes; it is still the widest thing this flag does, and the reason it is spelled out here.
    // The claim is RELEASED here as well as made — a codex session resumed into a project directory
    // reuses the id, and a stale claim would stand its group urls down with nothing left to serve
    // them (Codex review on #1399). claimFullGuiMcp owns both directions so neither spawn path can
    // apply half the rule.
    // A restricted session is handed exactly its groups, whatever the directory registered.
    const restricted = restrictedTo !== null;
    const claim: FullGuiClaimRequest = { sessionId, attachGuiMcp, cwd, wouldReattach: ptyWouldReattach(sessionId, true), agent: "codex", restricted };
    const { entry, spawnedAtMs, reattached } = spawnWithFullGuiClaim(claim, (allTools) => {
      const guiMcpServers = codexGuiMcpServers({ sessionId, port: PORT, groups: restrictedTo ?? mcpGroups, allTools });
      const permissionHook = wantsCodexPermissionHook(process.platform, initialPrompt !== null);
      const args = buildCodexArgs({ resume: resumeRolloutId, model: deps.codexModel, guiMcpServers, permissionHook });
      const spawnEnv = {
        binEnvVar: codexAdapter.binEnvVar,
        // The session id is what the permission hook's constant command posts under.
        env: { ...guiMcpEnv(sessionId, PORT), ...accountSpawnEnv("codex", sessionId) },
      };
      const note = resumeRolloutId ? `resume ${resumeRolloutId}` : null;
      return startAgentPty({ sessionId, ws, cwd, agent: "codex", file: deps.codexBin, args, spawnEnv, note });
    });
    if (resumeRolloutId) {
      // Recorded on resume too, not just on the spawn that discovered it: a session resumed by the
      // rollout id itself carries no mapping yet, and one whose cell moved needs the new cwd.
      rememberCodexRollout(sessionId, resumeRolloutId, cwd);
      const file = codexRolloutPath(root, resumeRolloutId);
      if (file) trackCodexActivity(sessionId, file, { startAtEnd: true }, activityDepsFor(sessionId, entry, deps));
    } else if (reattached) {
      // A tmux attach picked up a codex that was ALREADY running — a server restart, where
      // `agentResumeId` rightly withholds the resume id so no second codex starts. But the fresh
      // branch below waits for a rollout file to APPEAR, and this session's existed before the
      // snapshot — so nothing ever tailed it and the cell's working/waiting flags stayed dead
      // until a cold restart (#1536). Claude survives the same restart via its HTTP hooks; codex
      // has only this tail. The mapping outlived the process in the rollout log (the WS route
      // awaits its hydration before resolving), so tail it from the end, as a resume does —
      // except that a turn the file leaves OPEN is restored: unlike a resume, the process is
      // still running, so an open turn is what it is doing right now (#1538 review).
      const rolloutId = codexRollouts.get(sessionId)?.conversationId;
      const file = rolloutId ? codexRolloutPath(root, rolloutId) : null;
      if (file) trackCodexActivity(sessionId, file, { startAtEnd: true, restoreOpenTurn: true }, activityDepsFor(sessionId, entry, deps));
      // No mapping. Either the restart came before the survivor's FIRST turn, so no rollout exists
      // yet and its first prompt may still be coming (the appear-watcher; without it that rollout
      // is never recorded and a cold reconnect starts a NEW conversation — Codex review on #1538),
      // or the mapping was lost while the rollout already existed (#3283), which only the file
      // the survivor holds open can tell.
      else recoverUnmappedRollout(deps, sessionId, entry, root, before, cwd);
    } else {
      // Discover the id only for a FRESH session. On resume we already know it; running the watcher
      // could overwrite the known id with a mis-attributed concurrent rollout.
      captureCodexRollout(deps, sessionId, entry, root, before, cwd);
    }
    // A seed prompt is typed into codex's input box after it settles (not a CLI arg — see
    // attachCodexAutoRun), so a long collection-action prompt can't overflow tmux's command limit.
    const autoRun = initialPrompt ? attachCodexAutoRun(entry, initialPrompt) : undefined;
    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps, { onOutput: autoRun });
    return entry;
  }

  return { spawnCodexPty };
}
