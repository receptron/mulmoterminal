import express from "express";
import http from "http";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createPubSub } from "./infra/pubsub.js";
import { mountAllRoutes, allowedToolNames, toolSummaries } from "./infra/plugins-registry.js";
import { initMarkdownBackend } from "./backends/markdown.js";
import { initArtifactsBackend } from "./backends/artifacts.js";
import { mountConfigRoutes, getUserMcpServers, getWorklogConfig } from "./config/config-routes.js";
import { mountFilesBrowseRoutes } from "./files/files-browse.js";
import {
  tmuxAvailable,
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessionIds,
  tmuxPaneCommand,
  tmuxAttachedClientCount,
  tmuxCaptureStyledPane,
  isResumableTmuxSession,
} from "./infra/tmux.js";
import { mountTmuxRoutes } from "./infra/tmux-routes.js";
import { sandboxEnabled, sandboxPlatformSupported, dockerAvailable, ensureSandboxImage, cleanupSandbox } from "./infra/sandbox.js";
import { isAllowedOrigin } from "./infra/allowed-origin.js";
import { PORT, CLAUDE_CWD, MULMOTERMINAL_HOME, SESSION_ID_RE } from "./config/env.js";
import { hasErrnoCode, messageOf } from "./errors.js";
import { hookSettingsJson } from "./session/hook-settings.js";
import { mcpConfigJson } from "./session/mcp-config.js";
import { createClaudeSpawner } from "./session/spawn-claude.js";
import { createCodexSpawner } from "./session/spawn-codex.js";
import { createShellSpawners } from "./session/spawn-shell.js";
import { createTranslationWorker } from "./session/translation-worker.js";
import { createTitleManager } from "./session/session-title.js";
import { generateHeaderTitle } from "./config/header-title.js";
import { mountTerminalWebSockets } from "./routes/ws-routes.js";
import { mountHookRoute } from "./routes/hook-routes.js";
import { mountPluginRoutes } from "./routes/plugin-routes.js";
import { mountMcpRoutes } from "./routes/mcp-routes.js";
import { createConnectionHandlers } from "./session/pty-connection.js";
import type { SpawnDeps } from "./session/spawn-deps.js";
import {
  activity,
  aiTitles,
  devTerminalSessions,
  devTerminalSessionsHydrated,
  hiddenSessions,
  knownSessions,
  launchChoices,
  lastPrompts,
  lastResponses,
  lastTitleAttemptMs,
  lastTitledUserTurns,
  persistActivityState,
  ptys,
  titleInFlight,
} from "./session/registry.js";
import { parseWaitGraceMs, reapDecisionFor, reapTimerDelay, shouldForgetActivity } from "./session/reap-policy.js";
import { nextActivity, sessionRow, shouldRefreshReply } from "./session/activity-transition.js";
import { resolveWorkspace } from "./config/workspace.js";
import { mountSessionRoutes } from "./routes/session-routes.js";
import { createToolStores } from "./session/tool-store.js";
import { mountToolRoutes } from "./routes/tool-routes.js";
import { mountRepoRoutes } from "./routes/repo-routes.js";
import { claudeOnDiskSessionIds, readLatestResponse } from "./session/session-reads.js";
import { mountDirRoutes } from "./routes/dir-routes.js";
import { createScheduledSessionRegistry, heldByAnotherProcess, scheduledSessionsDir } from "./session/scheduled-sessions.js";
import { claudeAdapter } from "./agents/claude.js";
import { codexAdapter } from "./agents/codex.js";
import { codexSessionsRoot } from "./agents/codex-session.js";
import { codexRolloutExists } from "./agents/codex-sessions.js";
import { renderScreen } from "./session/headlessScreen.js";
import { cleanupSessionSettings } from "./session/session-settings.js";
import { agentFromPaneCommand, buildSessionList, captureSessionScreen } from "./backends/remoteHost/terminalScreen.js";
import { canClearInputBox } from "./backends/remoteHost/terminalInput.js";
import { mountOpenDirRoute } from "./files/open-dir.js";
import { mountGitRemoteRoute } from "./git/gitRemote.js";
import { mountWorktreeRoutes } from "./git/worktree-routes.js";
import { mountPickFileRoute } from "./files/pick-file.js";
import { mountCommandSummaryRoute } from "./session/command-summary.js";
import { mountCostRoute } from "./session/cost.js";
import { initCollectionsBackend, mountCollectionRoutes } from "./backends/collections.js";
import { initGoogleBackend, mountGoogleRoutes } from "./backends/google.js";
import { initPluginRuntime } from "./infra/pluginRuntime.js";
import { mountWikiRoutes } from "./backends/wiki.js";
import { initAccountingBackend, mountAccountingRoutes } from "./backends/accounting.js";
import { initFeedsBackend, mountFeedsRoutes } from "./backends/feeds.js";
import { HOST_ID as REMOTE_HOST_ID, initRemoteHostBackend, mountRemoteHostRoutes } from "./backends/remoteHost/index.js";
import { createSessionActivityPublisher, firestoreSessionActivityStore } from "./backends/remoteHost/sessionActivity.js";
import { currentFirestore, currentUid } from "./backends/remoteHost/session.js";
import { feedRefreshTaskDef, type AgentWorkerRunner } from "@mulmoclaude/core/feeds/server";
import { initWorkspaceSetup } from "./backends/workspaceSetup.js";
import { installConfigSkill } from "./infra/install-config-skill.js";
import { initFileChangePublisher } from "./backends/fileChange.js";
import { initNotifier, mountNotificationRoutes } from "./backends/notifier.js";
import { mountWhisperRoutes, stopWhisperSidecar } from "./backends/whisper.js";
import { startCollectionCompletionWatchers } from "./backends/collectionWatchers.js";
import { initUserTaskScheduler, mountSchedulerRoutes } from "./backends/scheduler.js";
import { worklogSystemTask } from "./backends/worklog.js";
import type { TaskDefinition } from "@mulmoclaude/core/scheduler";
import { mountFilesRoutes } from "./backends/files.js";
import { mountShortcutsRoutes } from "./backends/shortcuts.js";
import { mountTranslationRoutes } from "./backends/translation.js";
import { mountHtmlDispatchRoute, mountHtmlPreviewRoute } from "./backends/html.js";
import { initMulmoScriptBackend, mountMulmoScriptDispatchRoute, mountMulmoScriptMediaRoute } from "./backends/mulmoscript.js";
import { SPA_FALLBACK_RE } from "./infra/spa-fallback.js";

// Per-session activity flags, driven by Claude hooks (see /api/hook).

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLAUDE_BIN = claudeAdapter.bin();
const CODEX_BIN = codexAdapter.bin();
// Model override for codex sessions (--model); null uses codex's own configured default.
const CODEX_MODEL = process.env.CODEX_MODEL || null;
// Permission mode for backend-spawned Claude sessions. Defaults to "auto" so
// the backend runs hands-off; override with CLAUDE_PERMISSION_MODE (e.g.
// "default" / "acceptEdits" / "bypassPermissions" / "plan") when needed.
const CLAUDE_PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "auto";

// CLAUDE_CWD is the workspace used as the PTY cwd and as the root for persisted
// session state, so it must exist before we spawn anything into it.
await fs.mkdir(CLAUDE_CWD, { recursive: true });

// Seed help docs + preset skills so a MulmoTerminal-alone run gets the full
// workspace experience. Gated to the managed mulmoclaude workspace and
// fault-isolated per step, so it never aborts boot (see workspaceSetup.ts).
initWorkspaceSetup({ workspace: CLAUDE_CWD });

// Install the mulmoterminal-config skill into the user's global skills roots so any
// launched terminal can run `/mulmoterminal-config` to author a .mulmoterminal.json.
// Best-effort + never clobbers a user's own same-named skill (see install-config-skill.ts).
installConfigSkill();

// Pub/sub channel the sidebar subscribes to for live session-activity changes.
const SESSIONS_CHANNEL = "sessions";

// Pub/sub channel telling the client a directory's .mulmoterminal.json changed, so it re-reads that
// dir's config and recolours its cells without a page reload. Fed by the tool hooks, not a watcher.
const DIR_CONFIG_CHANNEL = "dir-config";

// Per-session pub/sub channel the GUI panel subscribes to. The MCP broker POSTs a
// toolResult to /api/agent/toolResult, which stores it keyed by session id and
// publishes it here (mirrors MulmoClaude's sessionChannel; see the spike doc).
const sessionChannel = (id: string) => `session:${id}`;

// The GUI MCP server is served in-process over Streamable HTTP at /api/mcp/:sessionId
// (see the route below) and wired into each spawned claude via --mcp-config. It
// exposes one GUI-protocol tool per enabled plugin (driven by plugins/plugins.json)
// and drives the GUI panel via the toolResult route.

// MCP tool names claude uses, in the mcp__<server>__<tool> form, one per enabled
// plugin. Auto-allowed via --allowedTools so the spike doesn't trip the permission
// prompt (permissions stay terminal-native). Comma-joined into one --allowedTools.
// The worker-only `submitTranslation` tool is allowed for every session (harmless —
// only hidden translation workers are actually shown it, see the /mcp route) so the
// worker can call it without a permission prompt.
const GUI_MCP_TOOLS = [...allowedToolNames(), "mcp__mulmoterminal-gui__submitTranslation"].join(",");

// The panel's per-session stores. `publish` is a closure rather than the pubsub object
// because pub/sub only exists once the HTTP server does, and these are built before it.
const toolStores = createToolStores({
  publish: (channel, data) => pubsub?.publish(channel, data),
});
const { recordToolCallStart, recordToolCallEnd } = toolStores;

function refreshLastResponse(id: string, cwd: string): void {
  const text = readLatestResponse(id, cwd);
  if (text) lastResponses.set(id, text); // a failed read leaves any prior value
}

// Bytes of recent output kept per pty and replayed when a client reattaches to
// a background session, so the user sees context instead of a blank screen.
const OUTPUT_BUFFER_LIMIT = 64 * 1024;

// Assigned once the HTTP server exists (createPubSub needs it).
let pubsub: ReturnType<typeof createPubSub> | null = null;

// Tear down a session's PTY and bookkeeping, then notify subscribers. The
// `activity` entry is dropped too — UNLESS it still carries `waiting`, which is
// what keeps a finished/needs-attention background session bold (via its
// on-disk record) until the user opens it. This keeps `activity` from growing
// unbounded while preserving the bold-until-viewed behavior.
// On disconnect we don't kill an idle session immediately — a page reload is a
// brief disconnect, and reaping then would throw away a perfectly good live
// terminal (and its scrollback). Instead we keep the pty for a grace window; a
// reattach within it cancels the reap, so a reload just re-attaches to the same
// running terminal. Only after the window with no reattach do we reap.
const REAP_GRACE_MS = 30_000;
// A detached session that still needs the user — mid-turn output the user hasn't
// seen, or blocked on a permission/question prompt (the `waiting` flag) — is an
// unfinished task: reaping it loses work. So it gets a much longer grace than an
// idle one, long enough that you can switch away, do other things, and come back
// to answer it. Override with WAIT_REAP_GRACE_MS=0 to never auto-close these.
const WAIT_REAP_GRACE_DEFAULT_MS = 30 * 60_000;
const WAIT_REAP_GRACE_MS = parseWaitGraceMs(process.env.WAIT_REAP_GRACE_MS, WAIT_REAP_GRACE_DEFAULT_MS, (raw) =>
  console.warn(`[pty] ignoring non-numeric WAIT_REAP_GRACE_MS=${JSON.stringify(raw)}; using default ${WAIT_REAP_GRACE_DEFAULT_MS}ms`),
);
const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelReap(id: string) {
  const t = reapTimers.get(id);
  if (t) {
    clearTimeout(t);
    reapTimers.delete(id);
  }
}

function scheduleReap(id: string, delayMs: number = REAP_GRACE_MS) {
  // null => never auto-reap; the session stays until reattached or explicitly
  // terminated (see reapTimerDelay for why a bad value must not reach setTimeout).
  const delay = reapTimerDelay(delayMs);
  if (delay === null) return;
  if (reapTimers.has(id)) return;
  reapTimers.set(
    id,
    setTimeout(() => {
      reapTimers.delete(id);
      const entry = ptys.get(id);
      if (entry && !entry.ws) reap(id); // still detached after the grace window
    }, delay),
  );
}

// Decide whether/when to reap a detached session based on its activity. A session
// that's actively thinking (`working`) is never reaped — that's "clearly working,
// don't close it". One that needs the user (`waiting`) gets the long grace. A
// genuinely idle session (finished AND already viewed, so neither flag) gets the
// short grace — that's the "auto-close inactive ones" behaviour. The ordering rule
// lives in reapDecisionFor (pure/tested).
function armReapForDetached(id: string) {
  const entry = ptys.get(id);
  if (!entry || entry.ws) return; // still attached: nothing to reap
  // Recompute from scratch: state may have escalated (idle -> waiting) since the
  // last arm, and a stale short timer must not survive to reap a session that now
  // needs the user. cancelReap clears it so scheduleReap re-arms with the right grace.
  cancelReap(id);
  const decision = reapDecisionFor(activity.get(id), { idleMs: REAP_GRACE_MS, waitingMs: WAIT_REAP_GRACE_MS });
  if (decision.kind === "keep") {
    console.log(`[pty] keeping working session ${id} alive (detached)`);
    return;
  }
  scheduleReap(id, decision.delayMs);
}

// Per-connection plumbing (session/pty-connection.ts). The reap decisions stay here —
// they read activity state and schedule timers that outlive any one connection.
const { reattachPty, handleClientFrame, handleClientClose } = createConnectionHandlers({
  cancelReap: (id) => cancelReap(id),
  reap: (id) => reap(id),
  setWaiting: (id, waiting) => setWaiting(id, waiting),
  armReapForDetached: (id) => armReapForDetached(id),
});

function reap(id: string) {
  cancelReap(id);
  const entry = ptys.get(id);
  if (!entry) return; // already reaped
  ptys.delete(id);
  // An unpersisted new session vanishes with its pty; a persisted one stays
  // visible via its on-disk record.
  knownSessions.delete(id);
  launchChoices.delete(id); // the picked backend dies with the session that used it
  lastPrompts.delete(id); // don't leak prompt text for torn-down sessions
  lastResponses.delete(id); // ditto, and keep this map from growing across closed sessions
  forgetTitle(id);
  sessionActivityPublisher.forget(id); // drop the phone's copy so its picker has no ghosts
  titleInFlight.delete(id);
  lastTitledUserTurns.delete(id); // teardown only — kept across /clear as the re-title baseline
  lastTitleAttemptMs.delete(id);
  if (shouldForgetActivity(activity.get(id))) {
    activity.delete(id);
    hiddenSessions.delete(id); // the hidden flag rides with the record — see shouldForgetActivity
  }
  try {
    entry.term.kill();
  } catch {
    // already gone
  }
  // Killing the pty only DETACHES a tmux client — end the tmux session too so an
  // explicit close / idle reap actually stops the program (no orphan within a live
  // server). A server crash never runs this, so sessions survive that (the point).
  if (entry.tmux) tmuxKillSession(id);
  // A sandbox container likewise outlives its killed `docker run` client — force-remove
  // it (and drop the throwaway per-session config).
  if (entry.sandbox) cleanupSandbox(id);
  // A provider session's settings file holds its token — drop it with the session (#579).
  cleanupSessionSettings(id);
  pubsub?.publish(SESSIONS_CHANNEL, { id, working: false, event: "closed" });
}

// Mirrors session activity into Firestore so the phone's terminal viewer can refresh
// on a real transition instead of polling (#439). Deduped and fire-and-forget inside;
// a no-op while the remote host is disconnected.
const sessionActivityPublisher = createSessionActivityPublisher({
  uid: currentUid,
  hostId: REMOTE_HOST_ID,
  store: firestoreSessionActivityStore(currentFirestore),
  onError: (err) => console.warn("[remote-host] session activity publish failed:", err),
});

// Publish a session's current activity (working + waiting) to subscribers.
function publishActivity(id: string) {
  const a = activity.get(id);
  // `cwd` rides along so the attention-sound player can pick up that directory's custom
  // sound (<cwd>/.mulmoterminal.json). Null for a session with no live PTY.
  const cwd = ptys.get(id)?.cwd ?? null;
  if (shouldRefreshReply(a, cwd)) refreshLastResponse(id, cwd);
  const row = sessionRow(id, a, cwd, {
    lastPrompt: lastPrompts.get(id),
    aiTitle: aiTitles.get(id),
    lastResponse: lastResponses.get(id),
  });
  sessionActivityPublisher.publish(id, { working: row.working, waiting: row.waiting });
  pubsub?.publish(SESSIONS_CHANNEL, row);
}

// AI-title bookkeeping (session/session-title.ts). publishActivity stays here — it
// publishes the whole session row, of which the title is one field.
const { forgetTitle, noteTitleTurn, maybeGenerateTitle, freshenRosterTitle } = createTitleManager({
  publishActivity: (id) => publishActivity(id),
  now: () => Date.now(),
  generateTitle: (raw) => generateHeaderTitle(raw),
});

// Claude is thinking (UserPromptSubmit) until it finishes (Stop). No-op (and no
// publish) when the state is unchanged.
function setWorking(id: string, working: boolean, event?: string) {
  const next = nextActivity(activity.get(id), { working }, event, Date.now());
  if (!next) return;
  activity.set(id, next);
  publishActivity(id);
  // Persist `working` so an in-progress turn survives a restart (see ACTIVITY_STATE_FILE).
  persistActivityState((id) => hiddenSessions.has(id));

  // A background session (no attached client) that just finished a turn is no
  // longer `working`. Don't kill it outright — if it ended its turn to ask the
  // user something (it'll be flagged `waiting`), reaping now would lose the task
  // before the user can answer. Arm a reap whose grace matches its state.
  if (!working) armReapForDetached(id);
}

// A background session needs the user's attention: it is waiting for input
// (Notification: permission / question / idle) or has finished a turn with
// output the user hasn't seen (Stop). Cleared when brought to the foreground
// (see the WebSocket connection handler).
function setWaiting(id: string, waiting: boolean, event?: string) {
  const next = nextActivity(activity.get(id), { waiting }, event, Date.now());
  if (!next) return;
  activity.set(id, next);
  publishActivity(id);
  // Persist the blocked/done set so it survives a server restart (see ACTIVITY_STATE_FILE).
  persistActivityState((id) => hiddenSessions.has(id));

  // A detached session that just started needing the user escalates from the short
  // idle grace to the long one — re-arm so it isn't reaped before they can return.
  if (waiting) armReapForDetached(id);
}

// The PTY spawners (session/spawn-*.ts). They take what index.ts still owns — the session
// lifecycle it drives, and this file's port and live user config bound into the two payload
// builders (session/hook-settings.ts, session/mcp-config.ts) — as deps.
const spawnDeps: SpawnDeps = {
  claudeBin: CLAUDE_BIN,
  codexBin: CODEX_BIN,
  codexModel: CODEX_MODEL,
  permissionMode: CLAUDE_PERMISSION_MODE,
  guiMcpTools: GUI_MCP_TOOLS,
  outputBufferLimit: OUTPUT_BUFFER_LIMIT,
  hookSettingsJson: (host, sessionId, env) => hookSettingsJson({ host, port: PORT, sessionId, env }),
  // The user's MCP servers are read per spawn, so a settings edit applies to the next session.
  mcpConfigJson: (sessionId, host, sandbox) => mcpConfigJson({ sessionId, host, port: PORT, userMcpServers: getUserMcpServers(), sandbox }),
  reap: (id) => reap(id),
  setWorking: (id, working, event) => setWorking(id, working, event),
  setWaiting: (id, waiting, event) => setWaiting(id, waiting, event),
  uiPort: String(process.env.CLIENT_PORT || PORT),
  publishSessionCreated: (sessionId) => pubsub?.publish(SESSIONS_CHANNEL, { id: sessionId, working: false, event: "created" }),
};
const { spawnClaudePty } = createClaudeSpawner(spawnDeps);
const { spawnCodexPty } = createCodexSpawner(spawnDeps);
const { spawnCommandPty, spawnLauncherPty, resolveLauncher } = createShellSpawners(spawnDeps);

// The hidden translation worker (session/translation-worker.ts). It drives a headless
// claude session, so it needs the spawner above and the reap this file owns.
const { translateViaHiddenChat } = createTranslationWorker({
  reap: (id) => reap(id),
  spawnHiddenChat: (sessionId, prompt) => {
    // ws=null → headless; the worker buffers output nobody reads. Default cwd = CLAUDE_CWD (trusted).
    spawnClaudePty(sessionId, null, null, { initialPrompt: prompt });
  },
});

const app = express();
// Generous body limit: PostToolUse hook payloads carry the tool's full output
// (a big Read/Bash result can blow past Express's 100kb default, which would 413
// the hook and leave its tool-call entry stuck on "running").
app.use(express.json({ limit: "25mb" }));

// The GUI-plugin tool routes this server answers itself: spawnBackgroundChat,
// manageAccounting, manageCollection (routes/plugin-routes.ts). ALL of them must precede
// mountAllRoutes' /api/plugin/:toolName catch-all below, which would otherwise take them.
mountPluginRoutes(app, { spawnClaudePty, spawnCodexPty });

// presentHtml View's source-editor dispatch (loadHtml/saveHtml) on
// /api/plugin/presentHtml. MUST precede mountAllRoutes' /api/plugin/:toolName
// catch-all (which handles the tool-call); a request without `kind` falls through.
mountHtmlDispatchRoute(app);

// presentMulmoScript: the View's dispatch (kind router) AND the tool-call both
// handled by the mulmoscript backend (realpath guard + autoGenerateMovie trigger
// the generic catch-all lacks). MUST precede mountAllRoutes. The media route
// (movie/PDF bytes for the View's fetchMediaBlob) has its own path.
mountMulmoScriptDispatchRoute(app);
mountMulmoScriptMediaRoute(app);

// Mount each enabled GUI plugin's REST routes (e.g. POST /api/markdown,
// POST /api/form). The GUI MCP server dispatches tool calls to these.
mountAllRoutes(app);

// Read-side collection routes (GET /api/collections/list + /:slug/detail) over the
// shared workspace, backing the @mulmoclaude/collection-plugin presentCollection
// card and (later) the collections toolbar. The engine itself is configured below
// once CLAUDE_CWD is the confirmed workspace.
mountCollectionRoutes(app);

// Read-only wiki routes (GET /api/wiki[?slug=] + /graph + /lint) over the shared
// workspace, thin consumers of @mulmoclaude/core/wiki/server. Claude authors the wiki
// via the real CLI in the terminal; MT's overlay only browses. Mounted before the /api
// SPA fallback.
mountWikiRoutes(app, { workspace: CLAUDE_CWD });

// Accounting dispatch route (POST /api/accounting) from @mulmoclaude/accounting-plugin.
// Drives BOTH the AccountingView (configureAccountingHost.apiCall) and the
// manageAccounting host tool below. The engine is configured (workspace + pub/sub)
// further down, once CLAUDE_CWD + pubsub exist.
mountAccountingRoutes(app);

// Collection Refresh route (POST /api/collections/:slug/refresh) from
// @mulmoclaude/core/feeds — fetches declarative feeds or dispatches an agent-ingest
// worker. Backs the collection-view Refresh button. The engine is configured below.
mountFeedsRoutes(app);

// Notification REST surface (list active / history, dismiss one) — backs the toolbar
// bell. The engine is configured below once pubsub + the workspace exist.
mountNotificationRoutes(app);

// Scheduler REST surface (read-only list of user cron tasks) — backs a future tasks
// UI. The tasks themselves are loaded + started below, once the spawn infra exists.
mountSchedulerRoutes(app, { workspace: CLAUDE_CWD });

// Raw workspace-file serving (GET /api/files/raw?path=) — backs collection image/file
// fields and custom-view <img> URLs. Rooted at the shared workspace.
mountFilesRoutes(app, { workspace: CLAUDE_CWD });

// Serve presentHtml pages for the View's iframe (GET /artifacts/html/<rest>) with an
// HTML preview CSP. The View navigates the iframe to this URL (htmlArtifactPreviewUrl).
mountHtmlPreviewRoute(app, { workspace: CLAUDE_CWD });

// Shared launcher favorites (GET/PUT /api/shortcuts) over the same
// <workspace>/config/shortcuts.json MulmoClaude uses — backs the collections toolbar.
mountShortcutsRoutes(app, { workspace: CLAUDE_CWD });

// Local voice input (POST /api/transcribe + model status/download) — macOS only,
// whisper.cpp via @mulmoclaude/core/whisper. Models live in the shared
// <workspace>/models dir, so a download by either app is reused.
mountWhisperRoutes(app, { workspace: CLAUDE_CWD });

// Runtime UI-string translation (POST /api/translation), backing the shared
// @mulmoclaude/core/translation/client. The HTTP contract + on-disk cache schema
// match MulmoClaude (so the <workspace>/data/translation cache is shared between the
// apps), but the LLM step is MulmoTerminal's own: translateViaHiddenChat spawns a
// hidden background claude session (NEVER `claude -p`) and is filtered from the
// sidebar (see session/translation-worker.ts).
mountTranslationRoutes(app, { workspace: CLAUDE_CWD, translateBatch: translateViaHiddenChat });

// The agent-facing MCP surface (routes/mcp-routes.ts): the in-process GUI MCP server over
// Streamable HTTP, and the worker-only landing point the hidden translation worker reports to.
mountMcpRoutes(app);

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

// SPA fallback for vue-router history mode: a hard reload / deep-link of a client
// route (e.g. /terminals, /collections/foo) must serve index.html. Mounted AFTER
// express.static so real asset files win, and after the /artifacts/html preview
// route (registered above) so it wins too. SPA_FALLBACK_RE reserves the single /api
// prefix — see server/spa-fallback.ts for why that's sufficient.
app.get(SPA_FALLBACK_RE, (_req, res) => res.sendFile(path.join(__dirname, "../dist/index.html")));

// The Claude hook endpoint (routes/hook-routes.ts). Session lifecycle, the title
// bookkeeping and the tool stores stay here; the fan-out that reads them moves out.
mountHookRoute(app, {
  setWorking: (id, working, event) => setWorking(id, working, event),
  setWaiting: (id, waiting, event) => setWaiting(id, waiting, event),
  publishActivity: (id) => publishActivity(id),
  forgetTitle,
  noteTitleTurn,
  maybeGenerateTitle,
  recordToolCallStart,
  recordToolCallEnd,
  publishDirConfig: (cwd) => pubsub?.publish(DIR_CONFIG_CHANNEL, { cwd }),
  // Express serves the built SPA on PORT; under `yarn dev` the UI is Vite's own server,
  // whose port the backend only knows when CLIENT_PORT is set in its environment.
  uiPort: String(process.env.CLIENT_PORT || PORT),
});

// The tools pane: the toolResult sink, its replay, the available-tool list and the
// call history (see routes/tool-routes.ts).
mountToolRoutes(app, { stores: toolStores, toolSummaries, publish: (c, d) => pubsub?.publish(c, d), sessionChannel });

// The /prs and /issues views (see routes/repo-routes.ts).
mountRepoRoutes(app);

// GET/POST /api/config (workspace dir + directory presets) — in its own module.
// GRID-ONLY (dev_tool): backs the grid launcher's default dir + the settings
// modal's directory presets. The single view never calls it.
mountConfigRoutes(app, CLAUDE_CWD);

// Project-scoped file browsing + editing for the full-screen Files view
// (GET /api/files/browse/{list,text,md}, PUT .../write — all ?cwd=&path=). Each
// terminal browses its own session's project dir; paths are contained within it.
mountFilesBrowseRoutes(app, { defaultCwd: CLAUDE_CWD });

// Directory-scoped reads for a terminal cell: scripts, skills, dir config, git status,
// PR phase, resolved header, custom sound. All keyed by ?cwd= (see routes/dir-routes.ts).
mountDirRoutes(app);

// GRID-ONLY (dev_tool): POST /api/open-dir reveals a cell's working directory in the
// OS file manager (a browser tab can't, but this local server can).
mountOpenDirRoute(app, { isAllowedOrigin });

// GRID-ONLY (dev_tool): POST /api/git-remote reports a cell dir's GitHub repository
// URL (null if it isn't a GitHub repo), so the header can offer an "open on GitHub" link.
mountGitRemoteRoute(app, { isAllowedOrigin });

// GRID-ONLY (dev_tool): /api/worktrees — detect a git repo, list/create/remove the
// per-agent worktrees a cell launches into, so several agents work one repo in
// isolated working trees.
mountWorktreeRoutes(app, { isAllowedOrigin });

// POST /api/pick-file opens the OS file dialog and returns the chosen absolute
// path(s) — how a browser tab inserts a real filesystem path into the terminal
// (the browser hides paths from drag/drop and <input type=file>).
mountPickFileRoute(app, { isAllowedOrigin });

// POST /api/command/summarize runs `claude -p` headless over a Run cell's captured
// terminal output and returns a short Errors/Warnings/cause/fix summary (issue #246).
// Same-origin guarded like the other local-action routes.
mountCommandSummaryRoute(app, { isAllowedOrigin });

// GET /api/cost — estimated $ cost (session + today/month roll-up) for a project's
// sessions, from public per-model pricing. Read-only; shown in the Settings modal (#245).
mountCostRoute(app, { resolveCwd: resolveWorkspace });

// POST /api/remote-host/connect|disconnect + GET /status — start/stop the
// Firestore host loop from the toolbar Connect control. Same-origin guarded like
// the other local-only routes; the connect idToken is never logged.
mountRemoteHostRoutes(app, { isAllowedOrigin });

// GET /api/google/status + POST /api/google/authorize|unlink — the Settings modal's
// Google account link. Consent needs a browser on THIS machine (loopback listener),
// which is exactly the local-browser case; `mulmoterminal google login` is the
// fallback for remote setups. Same-origin guarded; tokens never reach a response.
mountGoogleRoutes(app, { isAllowedOrigin });

// Sidebar listing, one session's detail, the grid's attention poll, the tool timeline and
// codex's own sessions (see routes/session-routes.ts).
mountSessionRoutes(app, { freshenRosterTitle });

// Explicit close (reliable reap over HTTP) + one-shot orphan cleanup. Extracted to a
// module so the origin guard / id validation / orphan-selection boundary are testable.
// Shared by the orphan cleanup (which must never reap a resumable session) and the phone's
// session picker (which must never OFFER a non-resumable one) — the same rule read from
// both directions, so they can't drift apart.
const resumableSessionPredicate = async (): Promise<(id: string) => boolean> => {
  await devTerminalSessionsHydrated;
  const live = new Set(ptys.keys());
  const claudeOnDisk = claudeOnDiskSessionIds();
  const codexRoot = codexSessionsRoot();
  return (id) => isResumableTmuxSession(id, live, devTerminalSessions, claudeOnDisk, (i) => codexRolloutExists(codexRoot, i));
};

mountTmuxRoutes(app, {
  isAllowedOrigin,
  isValidSessionId: (id) => SESSION_ID_RE.test(id),
  reapSession: reap,
  hasTmux: tmuxHasSession,
  killTmux: tmuxKillSession,
  listTmuxIds: tmuxListSessionIds,
  resumablePredicate: resumableSessionPredicate,
});

const server = http.createServer(app);
pubsub = createPubSub(server, isAllowedOrigin);

// Wire the shared file-change publisher (markdown + html live-refresh) against
// pubsub + the workspace. Must run before any write route fires (publishFileChange
// is a no-op until configured).
initFileChangePublisher({ workspace: CLAUDE_CWD, pubsub });

// Wire the notification engine against pubsub + the shared workspace files. Must run
// before any publish/clear and before the collection watchers start.
await initNotifier({ workspace: CLAUDE_CWD, pubsub });

// Give the markdown host app its workspace (for artifacts/documents storage).
// File-change live-refresh is handled by the shared publisher above.
initMarkdownBackend({ workspace: CLAUDE_CWD });

// Give the artifacts FileOps backend its workspace root (<workspace>/artifacts) so
// @mulmoclaude/chart-plugin's executeChart can persist chart documents there.
initArtifactsBackend({ workspace: CLAUDE_CWD });

// Create the mulmoScript server ops (stories dir under <workspace>/artifacts,
// generation fan-out on the plugin pubsub channel). After initArtifactsBackend —
// the ops' save/update kinds run against the artifacts FileOps.
initMulmoScriptBackend({ workspace: CLAUDE_CWD, pubsub });

// Configure the collection engine against the shared workspace (CLAUDE_CWD). The
// path layout matches MulmoClaude's so discovery sees the same collection skills.
initCollectionsBackend({ workspace: CLAUDE_CWD });

// Give factory-style gui-chat-protocol plugins their scoped runtime (per-package
// data/config under <workspace>, namespaced pub/sub, prefixed log) — see
// infra/pluginRuntime.ts. This necessarily lands AFTER the plugin registry built
// those runtimes (it calls the factories from a top-level await, so it finishes
// while this module's imports evaluate); the runtime tolerates that by resolving
// the workspace per operation rather than capturing it at construction.
initPluginRuntime({ workspace: CLAUDE_CWD, publish: (channel, data) => pubsub?.publish(channel, data) });

// Bind @mulmoclaude/core/google's logger. Token/secret storage is core's own and is
// shared with MulmoClaude (~/.config/mulmo, ~/.secrets), so a machine links once.
initGoogleBackend();

// Configure the accounting engine against the shared workspace + pub/sub. Books live
// under <workspace>/data/accounting; the publisher drives the View's live-refresh.
// Single pinned workspace root — exactly what the focused freelance product wants.
initAccountingBackend({ workspace: CLAUDE_CWD, pubsub });

// Configure the feeds engine (collection Refresh). The agent-ingest worker launcher is
// MulmoTerminal's own session spawn — adapted to @mulmoclaude/core/feeds' AgentWorkerRunner
// shape here (where spawnClaudePty lives) and injected, so the feeds backend never imports
// the session layer. A MANUAL refresh spawns a VISIBLE session (hidden:false) the user can
// watch; `onComplete` is honoured only for hidden (scheduled) workers, which MulmoTerminal
// doesn't register yet, so it's unused for now. `roleId` is ignored (no role system).
const feedsSpawnWorker: AgentWorkerRunner = async ({ message, hidden }) => {
  try {
    const sessionId = randomUUID();
    if (hidden) hiddenSessions.add(sessionId);
    spawnClaudePty(sessionId, null, null, { initialPrompt: message });
    return { ok: true, chatId: sessionId };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
};
initFeedsBackend({ workspace: CLAUDE_CWD, spawnWorker: feedsSpawnWorker });

// Remote host: let a phone drive MulmoTerminal over the Firestore command
// channel. startChat reuses spawnClaudePty for a VISIBLE session the user can
// watch. This only wires the singleton — the toolbar Connect control (which
// signs in as the user) starts the actual Firestore runner + presence heartbeat.
const remoteHostSpawnChat = (message: string) => {
  const sessionId = randomUUID();
  spawnClaudePty(sessionId, null, null, { initialPrompt: message });
  return { chatId: sessionId };
};
// The phone's remote terminal view (#435). Both accessors live here because the PTY table
// and the title/activity side-tables do; the backend only sees the two functions.
const remoteHostListTerminalSessions = async () =>
  buildSessionList({
    liveIds: [...ptys.keys()],
    tmuxIds: tmuxListSessionIds(),
    isResumable: await resumableSessionPredicate(),
    // Empty title rather than the id as a fallback — buildSessionList uses "nameless"
    // to drop the long tail of finished sessions the phone can't meaningfully offer.
    detailOf: (id) => ({
      title: aiTitles.get(id) ?? knownSessions.get(id)?.title ?? "",
      cwd: ptys.get(id)?.cwd ?? "",
      // A live session knows what it spawned. One that outlived us has no PtyEntry
      // left, so ask tmux what is running in it now — which is also the truer answer
      // when the user started a shell and ran an agent inside it.
      agent: ptys.get(id)?.agent ?? agentFromPaneCommand(tmuxPaneCommand(id)),
    }),
  });

// Write a chunk to a session's live PTY for the phone's terminal input (#445).
// Only sessions attached in THIS process are writable: a tmux session that outlived
// a restart is still viewable through capture-pane, but we hold no pty to type into.
const remoteHostWriteToSession = (sessionId: string, chunk: string): boolean => {
  const entry = ptys.get(sessionId);
  if (!entry) return false;
  try {
    entry.term.write(chunk);
    return true;
  } catch {
    // pty died between the lookup and the write
    return false;
  }
};

// Whether the phone's typing may empty the input box before pasting, so only the
// phone's text is submitted (#572). The rule itself lives with the sender.
const remoteHostCanClearBox = (sessionId: string): boolean => canClearInputBox(ptys.get(sessionId)?.agent, activity.get(sessionId)?.working);

const remoteHostCaptureTerminalScreen = (sessionId: string) =>
  captureSessionScreen(sessionId, {
    captureStyledPane: tmuxCaptureStyledPane,
    sourceOf: (id) => {
      const entry = ptys.get(id);
      return entry ? { buffer: entry.buffer, cols: entry.term.cols, rows: entry.term.rows } : undefined;
    },
    render: renderScreen,
  });

initRemoteHostBackend({
  workspace: CLAUDE_CWD,
  spawnChat: remoteHostSpawnChat,
  listTerminalSessions: remoteHostListTerminalSessions,
  captureTerminalScreen: remoteHostCaptureTerminalScreen,
  writeToSession: remoteHostWriteToSession,
  canClearBox: remoteHostCanClearBox,
});

// Mount per-collection fs.watchers → completion bells via the notifier. After the
// engine host + notifier are configured. Fire-and-forget + non-fatal: a watcher
// failure must never abort startup.
startCollectionCompletionWatchers().catch((err) => {
  console.error("[collection-watchers] failed to start — completion bells disabled", err);
});

// User-task scheduler: cron tasks from config/scheduler/tasks.json fire on schedule
// and spawn a NEW chat seeded with the task's prompt (e.g. the workout-log weekly
// nudge). The run-binding spawns a VISIBLE session so the user sees the result.
// Non-fatal: a scheduler failure must never abort startup.
//
// Nobody ever presses ✕ on a scheduled session, and one blocked on a permission prompt
// never finishes a turn, so the hook-driven reap can miss it entirely — hence the
// registry, which bounds them by count and age whatever their hooks did (#541).

// Would killing this session take it away from someone? Two answers are needed: our own
// viewer (a local fact) and any OTHER server process holding it, which only tmux can tell
// us — see heldByAnotherProcess for the arithmetic.
function scheduledSessionInUse(id: string): boolean {
  const entry = ptys.get(id);
  if (entry?.ws) return true; // our own user is looking at it
  return heldByAnotherProcess(tmuxAttachedClientCount(id), !!entry);
}

const scheduledSessions = createScheduledSessionRegistry({
  dir: scheduledSessionsDir(CLAUDE_CWD, MULMOTERMINAL_HOME),
  isValidId: (id) => SESSION_ID_RE.test(id),
  isInUse: scheduledSessionInUse,
  reapSession: reap,
  hasTmux: tmuxHasSession,
  killTmux: tmuxKillSession,
});
// Sweep at startup (catching sessions that outlived a restart — tmux survives one by
// design) and hourly, so the age cap holds even after the schedule is turned off.
const SCHEDULED_SWEEP_INTERVAL_MS = 60 * 60_000;
void scheduledSessions.sweep();
setInterval(() => void scheduledSessions.sweep(), SCHEDULED_SWEEP_INTERVAL_MS).unref();

function spawnScheduledChat(message: string): void {
  const sessionId = randomUUID();
  try {
    spawnClaudePty(sessionId, null, null, { initialPrompt: message });
    scheduledSessions.register(sessionId);
  } catch (err) {
    console.error(`[scheduler] failed to spawn chat for a scheduled task: ${messageOf(err)}`);
  }
}
try {
  // Register the shared hourly feed-refresh system task so a STANDALONE MulmoTerminal
  // (no MulmoClaude running) still refreshes due feed/agent-ingest collections. The feeds
  // host is already configured above (initFeedsBackend), so refreshDue can run. When both
  // apps run on the shared workspace, the engine's shared `lastFetchedAt` soft-dedups —
  // whoever refreshes first stamps it, the other's isFeedDue skips (plan: soft-dedup v1).
  // Built-in system tasks: the shared feed-refresh, plus the opt-in dev worklog
  // (registered only when worklog.enabled). null (worklog off) is filtered out.
  const systemTasks: TaskDefinition[] = [
    feedRefreshTaskDef({ workspaceRoot: CLAUDE_CWD }),
    worklogSystemTask({ ...getWorklogConfig(), spawnChat: spawnScheduledChat }),
  ].filter((task): task is TaskDefinition => task !== null);
  initUserTaskScheduler({
    workspace: CLAUDE_CWD,
    spawnChat: spawnScheduledChat,
    systemTasks,
  });
} catch (err) {
  console.error("[scheduler] init failed (non-fatal)", err);
}

// The terminal WebSocket endpoints (routes/ws-routes.ts).
mountTerminalWebSockets({
  server,
  isAllowedOrigin,
  claudeBin: CLAUDE_BIN,
  setWaiting: (id, waiting) => setWaiting(id, waiting),
  reattachPty,
  handleClientFrame,
  handleClientClose,
  spawnClaudePty,
  spawnCodexPty,
  spawnCommandPty,
  spawnLauncherPty,
  resolveLauncher,
});

// Exit code the launcher (bin/mulmoterminal.js) treats as "port was taken at
// bind time" so it can retry on a fresh port. Keep in sync with the launcher.
const PORT_IN_USE_EXIT_CODE = 75;

// A bind failure (most often the port already in use) must not surface as an
// unhandled 'error' event / stack trace — exit with a clear message instead.
server.on("error", (err) => {
  if (hasErrnoCode(err) && err.code === "EADDRINUSE") {
    console.error(`[mulmoterminal] Port ${PORT} is already in use — set PORT=<n> or pass --port <n>.`);
    process.exit(PORT_IN_USE_EXIT_CODE);
  }
  console.error(`[mulmoterminal] server error: ${messageOf(err)}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`mulmoterminal running at http://localhost:${PORT}`);
  if (tmuxAvailable()) {
    const surviving = tmuxListSessionIds();
    const detail = surviving.length ? ` — ${surviving.length} session(s) survived; reattach on connect` : "";
    console.log(`[tmux] persistence on${detail}`);
  } else {
    console.log("[tmux] not found — terminals are not persistent across a server restart");
  }
  if (sandboxEnabled()) {
    if (!sandboxPlatformSupported()) {
      console.log("[sandbox] MULMOTERMINAL_SANDBOX set but only supported on macOS for now — using host spawn");
    } else if (!dockerAvailable()) {
      console.log("[sandbox] MULMOTERMINAL_SANDBOX set but Docker daemon unreachable — using host spawn");
    } else if (ensureSandboxImage()) {
      console.log("[sandbox] on — single-view Claude runs in a Docker container");
    } else {
      console.log(
        "[sandbox] sandbox image unavailable (build failed?) — using host spawn. Build it with: docker build -f Dockerfile.sandbox -t mulmoterminal-sandbox .",
      );
    }
  }
});

// The whisper sidecar is a spawned child that won't die with the parent on a
// signal. Adding a signal listener suppresses Node's default termination, so we
// kill the sidecar and exit explicitly. `exit` covers the normal-return path.
process.once("exit", stopWhisperSidecar);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopWhisperSidecar();
    process.exit(0);
  });
}
