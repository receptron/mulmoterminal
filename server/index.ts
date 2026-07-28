import express from "express";
import http from "http";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createPubSub } from "./infra/pubsub.js";
import { hideErrorStacks } from "./infra/hide-error-stacks.js";
import { toolSummaries } from "./infra/plugins-registry.js";
import { initMarkdownBackend } from "./backends/markdown.js";
import { initArtifactsBackend } from "./backends/artifacts.js";
import { getUserMcpServers, getWorklogConfig, getTerminalSubmit, getQuickCommands, APP_CONFIG_FILE } from "./config/config-routes.js";
import { enforceKeymap } from "./config/keymap-check.js";
import { readFileSync } from "node:fs";
import { submitSequenceForAgent } from "../common/terminalSubmit.js";
import { refreshUpdateStatus } from "./config/update-status.js";
import {
  tmuxAvailable,
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessionIds,
  tmuxPaneCommand,
  tmuxAttachedClientCount,
  tmuxCaptureStyledPane,
} from "./infra/tmux.js";
import { sandboxEnabled, sandboxPlatformSupported, dockerAvailable, ensureSandboxImage } from "./infra/sandbox.js";
import { bindSecurityWarning, browserOriginHostnames, createIsAllowedOrigin } from "./infra/allowed-origin.js";
import { serverErrorExit } from "./infra/server-exit.js";
import { PORT, BIND_HOST, CLAUDE_CWD, MULMOTERMINAL_HOME, SESSION_ID_RE } from "./config/env.js";
import { isLoopbackBinding } from "./infra/loopback.js";
import { messageOf } from "./errors.js";
import { hookSettingsJson } from "./session/hook-settings.js";
import { mcpConfigJson } from "./session/mcp-config.js";
import { createClaudeSpawner } from "./session/spawn-claude.js";
import { createCodexSpawner } from "./session/spawn-codex.js";
import { createShellSpawners } from "./session/spawn-shell.js";
import { createTranslationWorker } from "./session/translation-worker.js";
import { createTitleManager } from "./session/session-title.js";
import { generateHeaderTitle } from "./config/header-title.js";
import { mountTerminalWebSockets } from "./routes/ws-routes.js";
import { createConnectionHandlers } from "./session/pty-connection.js";
import type { SpawnDeps } from "./session/spawn-deps.js";
import { activity, aiTitles, devTerminalSessions, hiddenSessions, knownSessions, lastPrompts, ptys } from "./session/registry.js";
import { runWithHiddenMarker } from "./session/hiddenMarker.js";
import { createToolStores } from "./session/tool-store.js";
import { createScheduledSessionRegistry, scheduledSessionInUse, scheduledSessionsDir } from "./session/scheduled-sessions.js";
import { claudeAdapter } from "./agents/claude.js";
import { codexAdapter } from "./agents/codex.js";
import { renderScreen } from "./session/headlessScreen.js";
import { agentFromPaneCommand, buildSessionList, captureSessionScreen, type SessionScreenMeta } from "./backends/remoteHost/terminalScreen.js";
import type { SessionAgent } from "../common/sessionAgent.js";
import { quickCommandsForAgent } from "./backends/remoteHost/quickCommands.js";
import { decideLaunchTerminal, NO_BROWSER_ERROR } from "./backends/remoteHost/launchTerminal.js";
import { LAUNCH_TERMINAL_CHANNEL } from "../common/launchAgent.js";
import { currentBranch } from "./git/git-status.js";
import { resolveGithubUrl } from "./git/gitRemote.js";
import { canClearInputBox } from "./backends/remoteHost/terminalInput.js";
import { initCollectionsBackend } from "./backends/collections.js";
import { initGoogleBackend } from "./backends/google.js";
import { initPluginRuntime } from "./infra/pluginRuntime.js";
import { initAccountingBackend } from "./backends/accounting.js";
import { initFeedsBackend } from "./backends/feeds.js";
import { HOST_ID as REMOTE_HOST_ID, initRemoteHostBackend } from "./backends/remoteHost/index.js";
import { createSessionActivityPublisher, firestoreSessionActivityStore } from "./backends/remoteHost/sessionActivity.js";
import { createWorkPhaseTracker } from "./session/work-phase-tracker.js";
import { currentFirestore, currentUid } from "./backends/remoteHost/session.js";
import { feedRefreshTaskDef, type AgentWorkerRunner } from "@mulmoclaude/core/feeds/server";
import { initWorkspaceSetup } from "./backends/workspaceSetup.js";
import { installBundledSkills } from "./infra/install-bundled-skills.js";
import { initFileChangePublisher } from "./backends/fileChange.js";
import { initNotifier } from "./backends/notifier.js";
import { stopWhisperSidecar } from "./backends/whisper.js";
import { startCollectionCompletionWatchers } from "./backends/collectionWatchers.js";
import { initUserTaskScheduler } from "./backends/scheduler.js";
import { worklogSystemTask } from "./backends/worklog.js";
import type { TaskDefinition } from "@mulmoclaude/core/scheduler";
import { initMulmoScriptBackend } from "./backends/mulmoscript.js";
import { createSessionLifecycle, SESSIONS_CHANNEL } from "./session/lifecycle.js";
import { mountAppRoutes } from "./routes/app-routes.js";
import { allowedToolNames, autoAllowedToolNames } from "./infra/plugins-registry.js";

import { resumableSessionPredicate } from "./session/resumable-sessions.js";
import { installProcessGuards } from "./infra/process-guards.js";
import { pruneOrphanSettings } from "./session/session-settings.js";

// Per-session activity flags, driven by Claude hooks (see /api/hook).

// Register the top-level uncaughtException/unhandledRejection guards before any async boot
// work runs, so a single unhandled error can't silently kill the backend and disconnect
// every terminal at once (see infra/process-guards.ts).
installProcessGuards();

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

// Install the skills we ship into the user's global skills roots so any launched terminal can run
// `/mulmoterminal-config` (author a .mulmoterminal.json) and `/mulmoterminal-bug-report`.
// Best-effort + never clobbers a user's own same-named skill (see install-bundled-skills.ts).
installBundledSkills();

// Pub/sub channel the sidebar subscribes to for live session-activity changes.

// Pub/sub channel telling the client a directory's .mulmoterminal.json changed, so it re-reads that
// dir's config and recolours its cells without a page reload. Fed by the tool hooks, not a watcher.

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

// What a GRID cell pre-approves. A grid cell is never handed --mcp-config: its GUI tools come
// from the user's OWN per-folder MCP config (`claude mcp add -s local`, `.mcp.json`), so
// MulmoTerminal cannot know which groups a directory registered — and does not need to. It
// names the auto-allowed groups unconditionally; entries for a server the session didn't
// register match nothing. Only `render` is here: it cannot act outside the Canvas panel, so
// running it without a prompt is the point. Every other group keeps Claude Code's own prompt.
const GRID_MCP_TOOLS = autoAllowedToolNames().join(",");

// The panel's per-session stores. `publish` is a closure rather than the pubsub object
// because pub/sub only exists once the HTTP server does, and these are built before it.
const toolStores = createToolStores({
  publish: (channel, data) => pubsub?.publish(channel, data),
});

// Bytes of recent output kept per pty and replayed when a client reattaches to
// a background session, so the user sees context instead of a blank screen. On
// reattach the client resets its terminal and rebuilds scrollback purely from
// this replay, so this — not xterm's 1000-line scrollback — is what caps how far
// back you can scroll after a reload. 64 KiB of escape-heavy TUI output rendered
// to only ~100 lines; size it to comfortably fill the client's ~1000-line
// scrollback (older lines past that are dropped client-side anyway).
const OUTPUT_BUFFER_LIMIT = 1024 * 1024;

// Assigned once the HTTP server exists (createPubSub needs it).
let pubsub: ReturnType<typeof createPubSub> | null = null;

// Tear down a session's PTY and bookkeeping, then notify subscribers. The
// `activity` entry is dropped too — UNLESS it still carries `waiting`, which is
// what keeps a finished/needs-attention background session bold (via its
// on-disk record) until the user opens it. This keeps `activity` from growing
// unbounded while preserving the bold-until-viewed behavior.

// Per-connection plumbing (session/pty-connection.ts). The reap decisions stay here —
// they read activity state and schedule timers that outlive any one connection.
const { reattachPty, handleClientFrame, handleClientClose } = createConnectionHandlers({
  cancelReap: (id) => cancelReap(id),
  reap: (id) => reap(id),
  setWaiting: (id, waiting) => setWaiting(id, waiting),
  armReapForDetached: (id) => armReapForDetached(id),
});

// Mirrors session activity into Firestore so the phone's terminal viewer can refresh
// on a real transition instead of polling (#439). Deduped and fire-and-forget inside;
// a no-op while the remote host is disconnected.
const sessionActivityPublisher = createSessionActivityPublisher({
  uid: currentUid,
  hostId: REMOTE_HOST_ID,
  store: firestoreSessionActivityStore(currentFirestore),
  onError: (err) => console.warn("[remote-host] session activity publish failed:", err),
});

// Session teardown + activity publishing (session/lifecycle.ts). `forgetTitle` is bound
// lazily because the title manager below needs publishActivity — the cycle is real.
// The live turn's planning-vs-editing phase, fed by the hook route and read by the activity
// publisher — the phone's status vocabulary needs it, and the publish path can't read the
// transcript the roster parses for the same answer (#727).
const workPhaseTracker = createWorkPhaseTracker();

const lifecycle = createSessionLifecycle({
  publish: (channel, data) => pubsub?.publish(channel, data),
  forgetTitle: (id) => forgetTitle(id),
  sessionActivityPublisher,
  workPhaseOf: (id) => workPhaseTracker.phaseOf(id),
  forgetWorkPhase: (id) => workPhaseTracker.forget(id),
});
const { cancelReap, reap, armReapForDetached, publishActivity, setWorking, setWaiting } = lifecycle;

// AI-title bookkeeping (session/session-title.ts). publishActivity stays here — it
// publishes the whole session row, of which the title is one field.
const { forgetTitle, noteTitleTurn, maybeGenerateTitle, freshenRosterTitle } = createTitleManager({
  publishActivity: (id) => publishActivity(id),
  now: () => Date.now(),
  generateTitle: (raw) => generateHeaderTitle(raw),
});

// The PTY spawners (session/spawn-*.ts). They take what index.ts still owns — the session
// lifecycle it drives, and this file's port and live user config bound into the two payload
// builders (session/hook-settings.ts, session/mcp-config.ts) — as deps.
const spawnDeps: SpawnDeps = {
  claudeBin: CLAUDE_BIN,
  codexBin: CODEX_BIN,
  codexModel: CODEX_MODEL,
  permissionMode: CLAUDE_PERMISSION_MODE,
  guiMcpTools: GUI_MCP_TOOLS,
  gridMcpTools: GRID_MCP_TOOLS,
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

// Before anything binds a port: a typo'd key binding must stop the boot with a message
// naming it, not disappear into a shortcut that silently never fires.
enforceKeymap(APP_CONFIG_FILE, {
  readConfig: () => {
    try {
      return JSON.parse(readFileSync(APP_CONFIG_FILE, "utf8"));
    } catch {
      return undefined; // missing or unparseable — not this check's business to report
    }
  },
  warn: (message) => console.warn(`\x1b[33m${message}\x1b[0m`),
  fail: (message) => {
    console.error(`\x1b[31m${message}\x1b[0m`);
    process.exit(1);
  },
});

// Which browser origins this server accepts, decided once from what the operator asked for
// (#956). Read here rather than inside the predicate so the same set is what the startup warning
// reports — a warning describing a different rule than the one enforced is worse than none.
const browserHostnames = browserOriginHostnames(BIND_HOST, process.env.MULMOTERMINAL_ALLOWED_ORIGINS);
const isAllowedOrigin = createIsAllowedOrigin(browserHostnames);

const app = express();
hideErrorStacks(app);
// Generous body limit: PostToolUse hook payloads carry the tool's full output
// (a big Read/Bash result can blow past Express's 100kb default, which would 413
// the hook and leave its tool-call entry stuck on "running").
mountAppRoutes(app, {
  clientDir: __dirname,
  isAllowedOrigin,
  publish: (channel, data) => pubsub?.publish(channel, data),
  sessionChannel,
  toolStores,
  toolSummaries,
  spawnClaudePty,
  spawnCodexPty,
  translateViaHiddenChat,
  freshenRosterTitle,
  forgetTitle,
  noteTitleTurn,
  noteWorkPhase: (id, event, toolName) => workPhaseTracker.note(id, event, toolName),
  maybeGenerateTitle,
  reap,
  setWorking,
  setWaiting,
  publishActivity,
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
  const sessionId = randomUUID();
  try {
    runWithHiddenMarker(hidden, sessionId, hiddenSessions, () => spawnClaudePty(sessionId, null, null, { initialPrompt: message }));
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
// A live session knows what it spawned. One that outlived us has no PtyEntry left, so ask
// tmux what is running in it now — which is also the truer answer when the user started a
// shell and ran an agent inside it. Null when neither can say.
const agentOfSession = (id: string): SessionAgent | null => ptys.get(id)?.agent ?? agentFromPaneCommand(tmuxPaneCommand(id));

const remoteHostListTerminalSessions = async () =>
  buildSessionList({
    liveIds: [...ptys.keys()],
    tmuxIds: tmuxListSessionIds(),
    isResumable: await resumableSessionPredicate(),
    // The phone lists the multi-terminal grid's cells only — not the single-view chat
    // session or a tmux shell that was never a grid cell. resumableSessionPredicate()
    // above already awaited devTerminalSessionsHydrated, so this set is fully seeded.
    isGridSession: (id) => devTerminalSessions.has(id),
    // Empty title rather than the id as a fallback — buildSessionList uses "nameless"
    // to drop the long tail of finished sessions the phone can't meaningfully offer.
    detailOf: (id) => ({
      title: aiTitles.get(id) ?? knownSessions.get(id)?.title ?? "",
      cwd: ptys.get(id)?.cwd ?? "",
      agent: agentOfSession(id),
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

// What the phone's per-session view heads the screen with (#786, mulmoserver#107): the same
// dir / branch / summary / prompt the grid cell shows, read from the tables /api/sessions
// answers from. A session that outlived a restart has no PtyEntry, so it has no cwd here and
// no branch to look up — those fields are simply absent, and the phone shows the screen alone.
const remoteHostSessionScreenMeta = async (sessionId: string): Promise<SessionScreenMeta> => {
  const cwd = ptys.get(sessionId)?.cwd ?? "";
  // Both git reads are independent, so the phone waits for one spawn rather than two.
  const [head, repoUrl] = await Promise.all([cwd ? currentBranch(cwd) : null, cwd ? resolveGithubUrl(cwd) : null]);
  return {
    cwd,
    branch: head?.branch ?? "",
    summary: aiTitles.get(sessionId) ?? "",
    prompt: lastPrompts.get(sessionId) ?? "",
    // The repository root, never /tree/<branch>: whether a branch is still ON GitHub cannot
    // be known without asking GitHub. `refs/remotes/origin/*` is a local cache, so a merged
    // branch deleted at merge time keeps resolving here until someone prunes — and every
    // branch this app creates is deleted that way. Measured: the tree URL 404s, the root
    // does not. A per-poll `ls-remote` is the only local fix and costs a network round trip
    // on a screen the phone polls (#832).
    githubUrl: repoUrl ?? "",
  };
};

const remoteHostCaptureTerminalScreen = (sessionId: string) =>
  captureSessionScreen(sessionId, {
    captureStyledPane: tmuxCaptureStyledPane,
    sourceOf: (id) => {
      const entry = ptys.get(id);
      return entry ? { buffer: entry.buffer, cols: entry.term.cols, rows: entry.term.rows } : undefined;
    },
    render: renderScreen,
    metaOf: remoteHostSessionScreenMeta,
    // Read from config on every screen so an edit in Settings reaches the phone without a
    // restart; scoped here rather than on the phone, which then needs no notion of session
    // kinds (#830).
    quickCommandsOf: (id) => quickCommandsForAgent(getQuickCommands(), agentOfSession(id)),
  });

// The phone asked for a new terminal in the directory of the session it was viewing (#831).
// The grid lives in the browser — markDevTerminalSession is only ever reached through the
// terminal WebSocket — so the host cannot open the cell, and publishes the request to
// whichever tab is connected instead. The phone sends a session id, never a path.
const remoteHostLaunchTerminal = (agent: unknown, sessionId: unknown) => {
  const decision = decideLaunchTerminal({
    agent,
    sessionId,
    cwdOf: (id) => ptys.get(id)?.cwd ?? null,
    listenerCount: pubsub?.subscriberCount(LAUNCH_TERMINAL_CHANNEL) ?? 0,
  });
  if (!decision.ok) return decision;
  // ONE tab, not every tab: this asks for a terminal to be opened, so a broadcast would open
  // one per connected browser. Delivery is also the authority on whether anyone was there —
  // the count above was read a moment earlier and that tab may have closed since.
  const delivered = pubsub?.publishToOne(LAUNCH_TERMINAL_CHANNEL, decision.request) ?? false;
  return delivered ? { ok: true as const } : { ok: false as const, error: NO_BROWSER_ERROR };
};

initRemoteHostBackend({
  workspace: CLAUDE_CWD,
  spawnChat: remoteHostSpawnChat,
  launchTerminal: remoteHostLaunchTerminal,
  listTerminalSessions: remoteHostListTerminalSessions,
  captureTerminalScreen: remoteHostCaptureTerminalScreen,
  writeToSession: remoteHostWriteToSession,
  canClearBox: remoteHostCanClearBox,
  // The byte(s) that submit for this session (#772), resolved live from config so the
  // phone's "send" commits the paste the same way the keyboard does. Scoped to the
  // session's agent — the mapping is Claude's binding, so a shell/codex session in the
  // picker keeps plain CR (same agent lookup as canClearBox above).
  submitSequence: (sessionId) => submitSequenceForAgent(ptys.get(sessionId)?.agent, getTerminalSubmit()),
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
// Nobody ever presses close on a scheduled session, and one blocked on a permission prompt
// never finishes a turn, so the hook-driven reap can miss it entirely — hence the
// registry, which bounds them by count and age whatever their hooks did (#541).

// The rule lives with heldByAnotherProcess (pure/tested); this only reads the live facts.
const sessionInUse = (id: string): boolean => {
  const entry = ptys.get(id);
  return scheduledSessionInUse({ hasViewer: !!entry?.ws, weHoldAPty: !!entry }, () => tmuxAttachedClientCount(id));
};

const scheduledSessions = createScheduledSessionRegistry({
  dir: scheduledSessionsDir(CLAUDE_CWD, MULMOTERMINAL_HOME),
  isValidId: (id) => SESSION_ID_RE.test(id),
  isInUse: sessionInUse,
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

// A bind failure (most often the port already in use) must not surface as an unhandled
// 'error' event / stack trace — exit with a clear message and the code the launcher reads
// (infra/server-exit.ts).
server.on("error", (err) => {
  const { message, code } = serverErrorExit(err, PORT);
  console.error(message);
  process.exit(code);
});

// Number(): PORT comes from the environment as a string, and the (port, host, cb) overload
// takes a number — the (port, cb) form we used before accepted either.
server.listen(Number(PORT), BIND_HOST, () => {
  console.log(`mulmoterminal running at http://localhost:${PORT}`);
  if (!isLoopbackBinding(server.address())) {
    console.warn(bindSecurityWarning(BIND_HOST, PORT, browserHostnames));
  }
  const surviving = tmuxAvailable() ? tmuxListSessionIds() : [];
  if (tmuxAvailable()) {
    const detail = surviving.length ? ` — ${surviving.length} session(s) survived; reattach on connect` : "";
    console.log(`[tmux] persistence on${detail}`);
  } else {
    console.log("[tmux] not found — terminals are not persistent across a server restart");
  }
  // A crash never reaches reap(), so settings files — one of which may hold a provider's API
  // token — outlive the sessions that used them. Anything not backed by a surviving tmux
  // session is an orphan: a PTY without tmux died with the server that owned it.
  const droppedSettings = pruneOrphanSettings(new Set(surviving));
  if (droppedSettings.length) console.log(`[settings] removed ${droppedSettings.length} orphaned session settings file(s)`);
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
  // Run the update check for the header badge (best-effort, non-blocking). Works under
  // `yarn dev` too, where the launcher — which used to be the only checker — isn't involved.
  void refreshUpdateStatus();
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
