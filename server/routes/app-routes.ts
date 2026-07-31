// Everything this server answers over HTTP, in the order the middleware stack needs.
//
// Moved out of index.ts (#548): a table of ~40 mount calls is a list of what exists, not a
// decision, and reading index.ts should not mean scrolling past it to reach the parts that
// do decide something. The ORDER still matters and is preserved exactly — the plugin tool
// routes must precede mountAllRoutes' /api/plugin/:toolName catch-all, and the SPA fallback
// must come after the static mount.
//
// What arrives as deps is what index.ts owns: the spawners, the session lifecycle, the title
// manager, the tool stores, and `publish` (pub/sub exists only once the HTTP server does).
import path from "node:path";
import { sameOriginGuard } from "./same-origin-guard.js";
import express, { type Express } from "express";
import { mountAllRoutes } from "../infra/plugins-registry.js";
import { mountConfigRoutes } from "../config/config-routes.js";
import { mountFilesBrowseRoutes } from "../files/files-browse.js";
import { mountTmuxRoutes } from "../infra/tmux-routes.js";
import { mountHookRoute } from "../routes/hook-routes.js";
import { mountPluginRoutes } from "../routes/plugin-routes.js";
import { mountMcpRoutes } from "../routes/mcp-routes.js";
import { guiCallRecorderFor, historyIsGuiOnly } from "../mcp/gui-call-history.js";
import type { SessionAgent } from "../../common/sessionAgent.js";
import { mountSessionRoutes } from "../routes/session-routes.js";
import { mountToolRoutes } from "../routes/tool-routes.js";
import { mountRepoRoutes } from "../routes/repo-routes.js";
import { mountIssueWorkRoutes } from "../routes/issue-work-routes.js";
import { mountDirRoutes } from "../routes/dir-routes.js";
import { mountGuiMcpRoutes } from "../routes/gui-mcp-routes.js";
import { mountDropRoutes } from "../routes/drop-routes.js";
import { mountOpenDirRoute } from "../files/open-dir.js";
import { mountGitRemoteRoute } from "../git/gitRemote.js";
import { mountWorktreeRoutes } from "../git/worktree-routes.js";
import { mountPickFileRoute } from "../files/pick-file.js";
import { mountCommandSummaryRoute } from "../session/command-summary.js";
import { mountCostRoute } from "../session/cost.js";
import { mountCollectionRoutes } from "../backends/collections.js";
import { mountGoogleRoutes } from "../backends/google.js";
import { mountWikiRoutes } from "../backends/wiki.js";
import { mountAccountingRoutes } from "../backends/accounting.js";
import { mountFeedsRoutes } from "../backends/feeds.js";
import { mountCalendarPushRoutes } from "../backends/calendarPush.js";
import { mountRemoteHostRoutes } from "../backends/remoteHost/index.js";
import { mountNotificationRoutes } from "../backends/notifier.js";
import { mountWhisperRoutes } from "../backends/whisper.js";
import { mountSchedulerRoutes } from "../backends/scheduler.js";
import { mountFilesRoutes } from "../backends/files.js";
import {
  hookedSessions,
  ptys,
  sessionToolGroups,
  sessionToolGroupsHydrated,
  devTerminalSessions,
  devTerminalSessionsHydrated,
  hasAllGuiTools,
  allToolsSessionsHydrated,
} from "../session/registry.js";
import { mountShortcutsRoutes } from "../backends/shortcuts.js";
import { mountDecisionRoutes } from "./decision-routes.js";
import { mountTranslationRoutes } from "../backends/translation.js";
import { mountHtmlDispatchRoute, mountHtmlFileRoute, mountHtmlPreviewRoute } from "../backends/html.js";
import { mountMulmoScriptDispatchRoute, mountMulmoScriptMediaRoute } from "../backends/mulmoscript.js";
import { CLAUDE_CWD, MULMOTERMINAL_HOME, PORT, SESSION_ID_RE } from "../config/env.js";
import { FILE_WRITE_CHANNEL, type FileWriteEvent } from "../../common/fileWriteChannel.js";
import type { createToolStores } from "../session/tool-store.js";
import type { createClaudeSpawner } from "../session/spawn-claude.js";
import type { createCodexSpawner } from "../session/spawn-codex.js";
import type { createAntigravitySpawner } from "../session/spawn-antigravity.js";
import type { createTranslationWorker } from "../session/translation-worker.js";
import type { createTitleManager } from "../session/session-title.js";
import { tmuxHasSession, tmuxKillSession, tmuxListSessionIds, tmuxAttachedClientCount } from "../infra/tmux.js";
import { resumableSessionPredicate } from "../session/resumable-sessions.js";
import type { SessionActivityDeps } from "../session/session-activity-deps.js";
import { mountSpaFallback } from "../infra/spa-fallback.js";
import { mountRateLimitRoutes, type RateLimitRouteDeps } from "../agents/rate-limit-routes.js";
import { workspaceForRoute } from "./routeParams.js";

export interface AppRouteDeps extends SessionActivityDeps {
  clientDir: string;
  rateLimits: RateLimitRouteDeps;
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  publish: (channel: string, data: unknown) => void;
  sessionChannel: (id: string) => string;
  toolStores: ReturnType<typeof createToolStores>;
  /** What a session is running, or null when the host cannot tell. Gates the broker's own
   *  tool-call history — see mcp/gui-call-history.ts. */
  agentOfSession: (id: string) => SessionAgent | null;
  toolSummaries: Parameters<typeof mountToolRoutes>[1]["toolSummaries"];
  spawnClaudePty: ReturnType<typeof createClaudeSpawner>["spawnClaudePty"];
  spawnCodexPty: ReturnType<typeof createCodexSpawner>["spawnCodexPty"];
  spawnAntigravityPty: ReturnType<typeof createAntigravitySpawner>["spawnAntigravityPty"];
  translateViaHiddenChat: ReturnType<typeof createTranslationWorker>["translateViaHiddenChat"];
  freshenRosterTitle: ReturnType<typeof createTitleManager>["freshenRosterTitle"];
  reap: (id: string) => void;
  registerBackgroundSession: (id: string) => void;
}

// The channel a directory-config change is announced on.
const DIR_CONFIG_CHANNEL = "dir-config";

// The two signals behind both halves of the broker-fed history: whether it is written at all, and
// whether the pane tells the user it holds the GUI tools alone. Read here so the two answers are
// built from one reading of the session — they are not the same question (the claim is stricter,
// see historyIsGuiOnly), but they must never be built from different facts.
const sessionCallReporting = (deps: AppRouteDeps, sessionId: string) => ({
  agent: deps.agentOfSession(sessionId),
  reportsOwnCalls: hookedSessions.has(sessionId),
});

export function mountAppRoutes(app: Express, deps: AppRouteDeps): void {
  const clientDir = deps.clientDir;

  // Before any route AND before any body parser: one same-origin gate for every state-changing
  // request, so a site the user visits cannot drive this server through their browser. Ahead of
  // the parsers so a request that is going to be refused is never handed a body to parse — the
  // gate reads only method, path and origin. Individual routes keep their own checks — this is
  // the floor, not a replacement.
  app.use(sameOriginGuard(deps.isAllowedOrigin));

  // Ahead of express.json, carrying its own raw parser: a dropped file is bytes under its own
  // content type, and a dropped .json would otherwise be parsed as a document rather than saved.
  mountDropRoutes(app);

  app.use(express.json({ limit: "25mb" }));

  // The GUI-plugin tool routes this server answers itself: spawnBackgroundChat,
  // manageAccounting, manageCollection (routes/plugin-routes.ts). ALL of them must precede
  // mountAllRoutes' /api/plugin/:toolName catch-all below, which would otherwise take them.
  mountPluginRoutes(app, {
    spawnClaudePty: deps.spawnClaudePty,
    spawnCodexPty: deps.spawnCodexPty,
    spawnAntigravityPty: deps.spawnAntigravityPty,
    registerBackgroundSession: deps.registerBackgroundSession,
  });

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

  // The other direction: POST /api/collections/:slug/calendar-push writes a collection's
  // records to the Google calendar its schema declares (path per MulmoClaude's
  // API_ROUTES.collections.calendarPush). Backs the collection-view Push button; reads the
  // workspace from the collection host configured below.
  mountCalendarPushRoutes(app);

  // Notification REST surface (list active / history, dismiss one) — backs the toolbar
  // bell. The engine is configured below once pubsub + the workspace exist.
  mountNotificationRoutes(app);

  // Scheduler REST surface (read-only list of user cron tasks) — backs a future tasks
  // UI. The tasks themselves are loaded + started below, once the spawn infra exists.
  mountSchedulerRoutes(app, { workspace: CLAUDE_CWD });

  // Raw file serving (GET /api/files/raw?path=[&cwd=]) — backs collection image/file
  // fields, custom-view <img> URLs, and terminal file-path links. Rooted at the shared
  // workspace; a `?cwd=` is honoured only for a live session's own directory.
  mountFilesRoutes(app, { workspace: CLAUDE_CWD, sessionCwds: () => [...ptys.values()].map((entry) => entry.cwd) });

  // Serve presentHtml pages for the View's iframe (GET /artifacts/html/<rest>) with an
  // HTML preview CSP. The View navigates the iframe to this URL (htmlArtifactPreviewUrl).
  mountHtmlPreviewRoute(app, { workspace: CLAUDE_CWD });

  // The same, for a page presentHtml was POINTED at rather than wrote (GET
  // /htmlfile/<scope>/…, built by htmlFileUrl). No containment root — see the route.
  mountHtmlFileRoute(app);

  // Shared launcher favorites (GET/PUT /api/shortcuts) over the same
  // <workspace>/config/shortcuts.json MulmoClaude uses — backs the collections toolbar.
  mountShortcutsRoutes(app, { workspace: CLAUDE_CWD });

  // Read-only decision log (GET /api/decisions?cwd=) — the questions a human was asked in this
  // project and what they chose, read back out of Claude's own transcripts. Writes nothing.
  mountDecisionRoutes(app);

  // Local voice input (POST /api/transcribe + model status/download) — macOS only,
  // whisper.cpp via @mulmoclaude/core/whisper. Models live in the shared
  // <workspace>/models dir, so a download by either app is reused.
  mountWhisperRoutes(app, { workspace: CLAUDE_CWD });

  // Runtime UI-string translation (POST /api/translation), backing the shared
  // @mulmoclaude/core/translation/client. The HTTP contract + on-disk cache schema
  // match MulmoClaude (so the <workspace>/data/translation cache is shared between the
  // apps), but the LLM step is MulmoTerminal's own: deps.translateViaHiddenChat spawns a
  // hidden background claude session (NEVER `claude -p`) and is filtered from the
  // sidebar (see session/translation-worker.ts).
  mountTranslationRoutes(app, { workspace: CLAUDE_CWD, translateBatch: deps.translateViaHiddenChat });

  // The agent-facing MCP surface (routes/mcp-routes.ts): the in-process GUI MCP server over
  // Streamable HTTP, and the worker-only landing point the hidden translation worker reports to.
  mountMcpRoutes(app, {
    publish: (c, d) => deps.publish(c, d),
    // codex and agy have no hooks, so the broker is the only place their tool calls can reach
    // the tools pane's history. Claude's do NOT come through here — it would double every entry
    // its own PreToolUse/PostToolUse already writes.
    guiCallHistory: (sessionId) => guiCallRecorderFor(sessionId, sessionCallReporting(deps, sessionId), deps.toolStores),
  });

  // Serve Vite build output
  app.use(express.static(path.join(clientDir, "../dist")));

  // SPA fallback for vue-router history mode: a hard reload / deep-link of a client
  // route (e.g. /terminals, /collections/foo) must serve index.html. Mounted AFTER
  // express.static so real asset files win, and after the /artifacts/html preview
  // route (registered above) so it wins too. SPA_FALLBACK_RE reserves the single /api
  // prefix — see server/spa-fallback.ts for why that's sufficient.
  mountSpaFallback(app, path.join(clientDir, "../dist"));

  // The Claude hook endpoint (routes/hook-routes.ts). Session lifecycle, the title
  // bookkeeping and the tool stores stay here; the fan-out that reads them moves out.
  mountSessionFacingRoutes(app, deps);
}

// The session-facing half: hooks, tool history, and everything the browser asks about a
// directory or a repository. Split from the block above only to keep each readable — the
// order across the two is still the order they are mounted in.
function mountSessionFacingRoutes(app: Express, deps: AppRouteDeps): void {
  mountHookRoute(app, {
    setWorking: (id, working, event) => deps.setWorking(id, working, event),
    setWaiting: (id, waiting, event) => deps.setWaiting(id, waiting, event),
    publishActivity: (id) => deps.publishActivity(id),
    forgetTitle: deps.forgetTitle,
    noteTitleTurn: deps.noteTitleTurn,
    noteWorkPhase: deps.noteWorkPhase,
    maybeGenerateTitle: deps.maybeGenerateTitle,
    recordToolCallStart: deps.toolStores.recordToolCallStart,
    recordToolCallEnd: deps.toolStores.recordToolCallEnd,
    publishDirConfig: (cwd) => deps.publish(DIR_CONFIG_CHANNEL, { cwd }),
    publishFileWrite: (file) => deps.publish(FILE_WRITE_CHANNEL, { file } satisfies FileWriteEvent),
    // Express serves the built SPA on PORT; under `yarn dev` the UI is Vite's own server,
    // whose port the backend only knows when CLIENT_PORT is set in its environment.
    uiPort: String(process.env.CLIENT_PORT || PORT),
  });

  // The tools pane: the toolResult sink, its replay, the available-tool list and the
  // call history (see routes/tool-routes.ts).
  mountToolRoutes(app, {
    stores: deps.toolStores,
    toolSummaries: deps.toolSummaries,
    sessionToolGroups,
    sessionToolGroupsHydrated,
    hasAllGuiTools,
    allToolsSessionsHydrated,
    isGridSession: (id) => devTerminalSessions.has(id),
    devTerminalSessionsHydrated,
    // Built from the same two signals as the broker's recorder, but with the stricter rule the
    // user-facing claim needs — see historyIsGuiOnly for why the pane must not answer this the
    // moment a session id exists.
    guiOnlyHistory: (id) => historyIsGuiOnly(sessionCallReporting(deps, id)),
    publish: (c, d) => deps.publish(c, d),
    sessionChannel: deps.sessionChannel,
  });

  // The /prs and /issues views (see routes/repo-routes.ts).
  mountRepoRoutes(app);

  // Starting work FROM an issue row in that view: the worktree plus its seeded session (#1173).
  mountIssueWorkRoutes(app, { spawnClaudePty: deps.spawnClaudePty, isAllowedOrigin: deps.isAllowedOrigin });

  // GET/POST /api/config (workspace dir + directory presets) — in its own module.
  // GRID-ONLY (dev_tool): backs the grid launcher's default dir + the settings
  // modal's directory presets. The single view never calls it.
  mountConfigRoutes(app, CLAUDE_CWD);

  // Project-scoped file browsing + editing for the full-screen Files view
  // (GET /api/files/browse/{list,text,md}, PUT .../write — all ?cwd=&path=). Each
  // terminal browses its own session's project dir; paths are contained within it.
  mountFilesBrowseRoutes(app, { defaultCwd: CLAUDE_CWD, backupRoot: path.join(MULMOTERMINAL_HOME, "backups") });

  // Directory-scoped reads for a terminal cell: scripts, skills, dir config, git status,
  // PR phase, resolved header, custom sound. All keyed by ?cwd= (see routes/dir-routes.ts).
  mountDirRoutes(app);
  mountGuiMcpRoutes(app);

  // GRID-ONLY (dev_tool): POST /api/open-dir reveals a cell's working directory in the
  // OS file manager (a browser tab can't, but this local server can).
  mountOpenDirRoute(app, { isAllowedOrigin: deps.isAllowedOrigin });

  // GRID-ONLY (dev_tool): POST /api/git-remote reports a cell dir's GitHub repository
  // URL (null if it isn't a GitHub repo), so the header can offer an "open on GitHub" link.
  mountGitRemoteRoute(app, { isAllowedOrigin: deps.isAllowedOrigin });

  // GRID-ONLY (dev_tool): /api/worktrees — detect a git repo, list/create/remove the
  // per-agent worktrees a cell launches into, so several agents work one repo in
  // isolated working trees.
  mountWorktreeRoutes(app, { isAllowedOrigin: deps.isAllowedOrigin });

  // POST /api/pick-file opens the OS file dialog and returns the chosen absolute
  // path(s) — how a browser tab inserts a real filesystem path into the terminal
  // (the browser hides paths from drag/drop and <input type=file>).
  mountPickFileRoute(app, { isAllowedOrigin: deps.isAllowedOrigin });

  // POST /api/command/summarize runs `claude -p` headless over a Run cell's captured
  // terminal output and returns a short Errors/Warnings/cause/fix summary (issue #246).
  // Same-origin guarded like the other local-action routes.
  mountCommandSummaryRoute(app, { isAllowedOrigin: deps.isAllowedOrigin });

  // The 5h / 7d rate-limit gauge (#387): where the probe reports and where the header reads.
  mountRateLimitRoutes(app, deps.rateLimits);

  // GET /api/cost — estimated $ cost (session + today/month roll-up) for a project's
  // sessions, from public per-model pricing. Read-only; shown in the Settings modal (#245).
  mountCostRoute(app, { resolveCwd: workspaceForRoute });

  // POST /api/remote-host/connect|disconnect + GET /status — start/stop the
  // Firestore host loop from the toolbar Connect control. Same-origin guarded like
  // the other local-only routes; the connect idToken is never logged.
  mountRemoteHostRoutes(app, { isAllowedOrigin: deps.isAllowedOrigin });

  // GET /api/google/status + POST /api/google/authorize|unlink — the Settings modal's
  // Google account link. Consent needs a browser on THIS machine (loopback listener),
  // which is exactly the local-browser case; `mulmoterminal google login` is the
  // fallback for remote setups. Same-origin guarded; tokens never reach a response.
  mountGoogleRoutes(app, { isAllowedOrigin: deps.isAllowedOrigin });

  // Sidebar listing, one session's detail, the grid's attention poll, the tool timeline and
  // codex's own sessions (see routes/session-routes.ts).
  mountSessionRoutes(app, { freshenRosterTitle: deps.freshenRosterTitle, publishActivity: deps.publishActivity });

  // Explicit close (reliable deps.reap over HTTP) + one-shot orphan cleanup. Extracted to a
  // module so the origin guard / id validation / orphan-selection boundary are testable.
  // Shared by the orphan cleanup (which must never deps.reap a resumable session) and the phone's
  // session picker (which must never OFFER a non-resumable one) — the same rule read from
  // both directions, so they can't drift apart.

  mountTmuxRoutes(app, {
    isAllowedOrigin: deps.isAllowedOrigin,
    isValidSessionId: (id) => SESSION_ID_RE.test(id),
    reapSession: deps.reap,
    hasTmux: tmuxHasSession,
    killTmux: tmuxKillSession,
    listTmuxIds: tmuxListSessionIds,
    attachedClientCount: tmuxAttachedClientCount,
    resumablePredicate: resumableSessionPredicate,
  });
}
