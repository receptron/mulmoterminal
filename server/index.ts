import express from "express";
import http from "http";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPubSub } from "./infra/pubsub.js";
import { mountAllRoutes, allowedToolNames, toolSummaries } from "./infra/plugins-registry.js";
import { buildGuiMcpServer } from "./mcp/broker.js";
import { initMarkdownBackend } from "./backends/markdown.js";
import { initArtifactsBackend } from "./backends/artifacts.js";
import { mountConfigRoutes, getUserMcpServers, getPushEnabled, getWorklogConfig } from "./config/config-routes.js";
import { sendWebPush } from "./infra/web-push.js";
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
import { sandboxEnabled, sandboxPlatformSupported, dockerAvailable, ensureSandboxImage, cleanupSandbox, rewriteLoopbackForDocker } from "./infra/sandbox.js";
import { dirConfigWriteTarget } from "./config/dir-config.js";
import { activityHookEffects, buildPushText, pushKindFor, resolveHookSessionId, type PushKind } from "./session/activity-hook.js";
import { PORT, CLAUDE_CWD, MULMOTERMINAL_HOME, SESSION_ID_RE } from "./config/env.js";
import { hasErrnoCode, messageOf } from "./errors.js";
import { createClaudeSpawner } from "./session/spawn-claude.js";
import { createCodexSpawner } from "./session/spawn-codex.js";
import { createShellSpawners } from "./session/spawn-shell.js";
import { createTranslationWorker, failPendingTranslation, submitTranslation } from "./session/translation-worker.js";
import { createTitleManager } from "./session/session-title.js";
import { generateHeaderTitle } from "./config/header-title.js";
import { mountTerminalWebSockets } from "./routes/ws-routes.js";
import { createConnectionHandlers } from "./session/pty-connection.js";
import type { SpawnDeps } from "./session/spawn-deps.js";
import {
  activity,
  aiTitles,
  devTerminalSessions,
  devTerminalSessionsHydrated,
  hiddenSessions,
  knownSessions,
  lastPrompts,
  lastResponses,
  lastTitleAttemptMs,
  lastTitledUserTurns,
  translationWorkerIds,
  persistActivityState,
  ptys,
  titleInFlight,
} from "./session/registry.js";
import { reapDecisionFor } from "./session/reap-policy.js";
import { resolveWorkspace } from "./config/workspace.js";
import { mountSessionRoutes } from "./routes/session-routes.js";
import { createToolStores } from "./session/tool-store.js";
import { mountToolRoutes } from "./routes/tool-routes.js";
import { mountRepoRoutes } from "./routes/repo-routes.js";
import { claudeOnDiskSessionIds, latestUserPrompt, readLatestResponse } from "./session/session-reads.js";
import { mountDirRoutes } from "./routes/dir-routes.js";
import { createScheduledSessionRegistry, heldByAnotherProcess, scheduledSessionsDir } from "./session/scheduled-sessions.js";
import { claudeAdapter } from "./agents/claude.js";
import { codexAdapter } from "./agents/codex.js";
import { codexSessionsRoot } from "./agents/codex-session.js";
import { codexRolloutExists } from "./agents/codex-sessions.js";
import { codexifySkillSeed } from "./agents/codex-skills.js";
import { renderScreen } from "./session/headlessScreen.js";
import { agentFromPaneCommand, buildSessionList, captureSessionScreen } from "./backends/remoteHost/terminalScreen.js";
import { canClearInputBox } from "./backends/remoteHost/terminalInput.js";
import { isRecord, preferredHeaderPrompt } from "./session/transcript.js";
import { mountOpenDirRoute } from "./files/open-dir.js";
import { mountGitRemoteRoute } from "./git/gitRemote.js";
import { mountWorktreeRoutes } from "./git/worktree-routes.js";
import { mountPickFileRoute } from "./files/pick-file.js";
import { mountCommandSummaryRoute } from "./session/command-summary.js";
import { mountCostRoute } from "./session/cost.js";
import { initCollectionsBackend, mountCollectionRoutes } from "./backends/collections.js";
import { initGoogleBackend, mountGoogleRoutes } from "./backends/google.js";
import { initPluginRuntime } from "./infra/pluginRuntime.js";
import { manageCollectionHandler } from "./infra/collection-tool.js";
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

// Only same-machine browser origins may open the terminal / pub-sub sockets, so
// a malicious website the user visits can't drive the local Claude PTY (a
// cross-site WebSocket hijack). A missing Origin (non-browser local client) is
// allowed; any localhost host on any port is allowed (covers the Vite dev proxy).
function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

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

const LAST_PROMPT_CAP = 200;

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
const WAIT_REAP_GRACE_MS = (() => {
  const def = 30 * 60_000;
  const raw = process.env.WAIT_REAP_GRACE_MS;
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.warn(`[pty] ignoring non-numeric WAIT_REAP_GRACE_MS=${JSON.stringify(raw)}; using default ${def}ms`);
    return def;
  }
  return n; // a non-positive value means "never auto-reap waiting sessions" (see scheduleReap)
})();
const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelReap(id: string) {
  const t = reapTimers.get(id);
  if (t) {
    clearTimeout(t);
    reapTimers.delete(id);
  }
}

// Node's setTimeout delay is a signed 32-bit int; a larger value overflows and
// fires at ~1ms. Clamp to the max so a big grace doesn't become an instant reap.
const MAX_TIMER_MS = 2_147_483_647;

function scheduleReap(id: string, delayMs: number = REAP_GRACE_MS) {
  // Non-positive or non-finite (e.g. a bad env value yielding NaN) => never
  // auto-reap; the session stays until reattached or explicitly terminated.
  // Guarding here matters because setTimeout(..., NaN) would fire ~immediately.
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  if (reapTimers.has(id)) return;
  const delay = Math.min(delayMs, MAX_TIMER_MS);
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
  lastPrompts.delete(id); // don't leak prompt text for torn-down sessions
  lastResponses.delete(id); // ditto, and keep this map from growing across closed sessions
  forgetTitle(id);
  sessionActivityPublisher.forget(id); // drop the phone's copy so its picker has no ghosts
  titleInFlight.delete(id);
  lastTitledUserTurns.delete(id); // teardown only — kept across /clear as the re-title baseline
  lastTitleAttemptMs.delete(id);
  const a = activity.get(id);
  if (!a || (!a.working && !a.waiting)) {
    activity.delete(id);
    // Drop the hidden flag only when activity is dropped too — while `waiting`
    // persists (the bold-until-viewed window), keep it so the row stays un-bold.
    hiddenSessions.delete(id);
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
  const a = activity.get(id) || {};
  const cwd = ptys.get(id)?.cwd ?? null;
  // A turn just ended (waiting) → capture the reply's tail for the roster.
  if (a.waiting && cwd) refreshLastResponse(id, cwd);
  sessionActivityPublisher.publish(id, { working: a.working ?? false, waiting: a.waiting ?? false });
  pubsub?.publish(SESSIONS_CHANNEL, {
    id,
    // The session's working dir, so the attention-sound player can pick up that
    // directory's custom sound (<cwd>/.mulmoterminal.json). Null for a session with
    // no live PTY (a reaped background worker).
    cwd,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    event: a.event ?? null,
    lastPrompt: lastPrompts.get(id) ?? null,
    aiTitle: aiTitles.get(id) ?? null,
    lastResponse: lastResponses.get(id) ?? null,
  });
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
  const prev = activity.get(id) || {};
  if ((prev.working ?? false) === working) return;
  activity.set(id, { ...prev, working, event: event ?? prev.event ?? null, at: Date.now() });
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
  const prev = activity.get(id) || {};
  if ((prev.waiting ?? false) === waiting) return;
  activity.set(id, { ...prev, waiting, event: event ?? prev.event ?? null, at: Date.now() });
  publishActivity(id);
  // Persist the blocked/done set so it survives a server restart (see ACTIVITY_STATE_FILE).
  persistActivityState((id) => hiddenSessions.has(id));

  // A detached session that just started needing the user escalates from the short
  // idle grace to the long one — re-arm so it isn't reaped before they can return.
  if (waiting) armReapForDetached(id);
}

// Hook config injected via `claude --settings <json>`. Each event POSTs the full
// hook payload to /api/hook. UserPromptSubmit => working, Stop => idle,
// Notification => waiting for input. PreToolUse/PostToolUse/PostToolUseFailure
// (matcher "" => every tool, including built-ins and MCP tools) feed the
// per-session tool-call history that the GUI's tools pane shows. A failed tool
// fires PostToolUseFailure (NOT PostToolUse), so we register both to complete the
// entry either way — otherwise a failed call would stay stuck on "running".
function hookSettingsJson(host: string, sessionId: string) {
  // Tag every hook with mulmoterminal's STABLE session id via a header. Claude reissues its own session_id
  // on /clear and /compact, but the PTY — and the id the client tracks — stays this one, so attributing
  // hooks by this header keeps activity / header prompt / tool history correlated across a clear.
  const cmd = `curl -s -X POST http://${host}:${PORT}/api/hook ` + `-H 'content-type: application/json' -H 'x-mt-session: ${sessionId}' -d @- >/dev/null 2>&1`;
  const entry = [{ hooks: [{ type: "command", command: cmd }] }];
  // Tool hooks take a matcher; "" matches all tools.
  const toolEntry = [{ matcher: "", hooks: [{ type: "command", command: cmd }] }];
  return JSON.stringify({
    hooks: {
      UserPromptSubmit: entry,
      Stop: entry,
      Notification: entry,
      // SessionStart fires with source "clear" on /clear — we use it to reset the header prompt.
      SessionStart: entry,
      PreToolUse: toolEntry,
      PostToolUse: toolEntry,
      PostToolUseFailure: toolEntry,
    },
  });
}

// MCP config injected via `claude --mcp-config <json>`. Points claude at the
// in-process GUI MCP server served over Streamable HTTP. The session id rides in
// the URL path (the MCP server is otherwise stateless), so no env or subprocess is
// needed — the agent just makes an HTTP call back to this server. Using
// 127.0.0.1 (not localhost) avoids an IPv6/IPv4 resolution mismatch against the
// server's listen address.
function mcpConfigJson(sessionId: string, host: string = "127.0.0.1", sandbox: boolean = false) {
  const mcpServers: Record<string, { type: string; url: string }> = {};
  // User-added HTTP MCP servers (Settings). In the sandbox their loopback host is
  // rewritten so the container can reach a server running on the host. Added FIRST so
  // the built-in GUI entry below always wins (sanitizeUserMcpServers already reserves
  // its id, this is defense in depth).
  for (const s of getUserMcpServers()) {
    mcpServers[s.id] = { type: "http", url: sandbox ? rewriteLoopbackForDocker(s.url) : s.url };
  }
  mcpServers["mulmoterminal-gui"] = { type: "http", url: `http://${host}:${PORT}/api/mcp/${sessionId}` };
  return JSON.stringify({ mcpServers });
}

// The PTY spawners (session/spawn-*.ts). They take what index.ts still owns — the session
// lifecycle it drives and the config it builds the hook/MCP json from — as deps.
const spawnDeps: SpawnDeps = {
  claudeBin: CLAUDE_BIN,
  codexBin: CODEX_BIN,
  codexModel: CODEX_MODEL,
  permissionMode: CLAUDE_PERMISSION_MODE,
  guiMcpTools: GUI_MCP_TOOLS,
  outputBufferLimit: OUTPUT_BUFFER_LIMIT,
  hookSettingsJson,
  mcpConfigJson,
  reap: (id) => reap(id),
  setWorking: (id, working) => setWorking(id, working),
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
    spawnClaudePty(sessionId, null, null, prompt);
  },
});

const app = express();
// Generous body limit: PostToolUse hook payloads carry the tool's full output
// (a big Read/Bash result can blow past Express's 100kb default, which would 413
// the hook and leave its tool-call entry stuck on "running").
app.use(express.json({ limit: "25mb" }));

// Host tool: spawnBackgroundChat. Unlike a plugin (handled by mountAllRoutes'
// catch-all), it needs server internals — it spawns a brand-new interactive Claude
// terminal session, seeded with `message`, that the user can open from the sidebar.
// `role` is ignored (MulmoTerminal has no roles). `hidden:true` marks it a background
// worker: it still lists in the sidebar but never renders bold/unread when it
// finishes. `draft:true` makes `message` an editable DRAFT — typed into the input box
// but NOT auto-submitted (the collection-plugin's startNewChatDraft / template cards),
// so the user reviews and presses Enter. Registered BEFORE mountAllRoutes so this
// specific route wins over /api/plugin/:toolName.
app.post("/api/plugin/spawnBackgroundChat", (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return res.json({ message: "spawnBackgroundChat: `message` is required (non-empty string)." });
  }
  const draft = body.draft === true;
  const agent = body.agent === "codex" ? "codex" : "claude";
  const sessionId = randomUUID();
  if (body.hidden === true) hiddenSessions.add(sessionId);
  // ws is null: the session runs headless until the user opens it (reattach replays the buffered
  // output). A claude draft spawns with NO initial prompt (so it doesn't auto-run) and gets the text
  // typed into its input box. codex has no editable-draft path (no stable TUI ready-marker), so its
  // seed always auto-runs as codex's positional first-turn prompt, with the GUI MCP attached.
  try {
    if (agent === "codex") spawnCodexPty(sessionId, null, null, CLAUDE_CWD, true, codexifySkillSeed(message));
    else if (draft) spawnClaudePty(sessionId, null, null, undefined, CLAUDE_CWD, true, message);
    else spawnClaudePty(sessionId, null, null, message);
  } catch (err) {
    console.error(`[spawnBackgroundChat] failed for ${sessionId}: ${messageOf(err)}`);
    return res.json({ message: `Failed to spawn a new session: ${messageOf(err)}` });
  }
  return res.json({ message: backgroundChatMessage(agent, draft, sessionId), jsonData: { chatId: sessionId, agent } });
});

function backgroundChatMessage(agent: "claude" | "codex", draft: boolean, sessionId: string): string {
  if (agent === "codex") return `Spawned a new codex session (chatId ${sessionId}) auto-running the prompt.`;
  if (draft) return `Opened a new terminal session (chatId ${sessionId}) with the text prefilled in the input for the user to review and send.`;
  return `Spawned a new terminal session (chatId ${sessionId}). It runs in parallel; the user can open it from the sidebar.`;
}

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

// Host tool: manageAccounting. The accounting package exposes no gui-chat-protocol
// `.` core (just the Vue View + the /api/accounting router), so — like MulmoClaude's
// host-side passthrough execute — this route bridges the GUI MCP tool to that router.
// The router's envelope ({ action, ...data, message }) flows straight back to the
// broker: `data` (set for PREVIEW actions) gates the GUI publish, `message` narrates
// to claude. Registered BEFORE mountAllRoutes so it wins over /api/plugin/:toolName.
app.post("/api/plugin/manageAccounting", async (req, res) => {
  try {
    const upstream = await fetch(`http://127.0.0.1:${PORT}/api/accounting`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isRecord(req.body) ? req.body : {}),
    });
    const body: unknown = await upstream.json().catch(() => ({}));
    // The router 4xx's domain errors as { error }. Surface that as narration so claude
    // can read + retry, rather than a thrown tool call (broker's postJson rejects non-2xx).
    if (!upstream.ok) {
      const errMsg = isRecord(body) && typeof body.error === "string" ? body.error : `accounting request failed (HTTP ${upstream.status})`;
      return res.json({ message: errMsg });
    }
    return res.json(body);
  } catch (err) {
    console.error(`[manageAccounting] dispatch failed: ${messageOf(err)}`);
    return res.json({ message: `accounting dispatch failed: ${messageOf(err)}` });
  }
});

// Host tool: manageCollection — the shared collection data plane
// (@mulmoclaude/core/collection/server, bound in server/infra/collection-tool.ts).
// The engine runs in-process against the workspace configured by
// initCollectionsBackend below, so the route calls the handler directly. The
// result string (JSON for the read/write actions) narrates to claude via the
// envelope `message`; no `data`, so nothing publishes to the GUI — same as
// MulmoClaude. Errors surface as narration, not thrown tool calls, so the
// agent can read and retry. Registered BEFORE mountAllRoutes so it wins over
// /api/plugin/:toolName.
app.post("/api/plugin/manageCollection", async (req, res) => {
  try {
    const message = await manageCollectionHandler(isRecord(req.body) ? req.body : {});
    return res.json({ message });
  } catch (err) {
    console.error(`[manageCollection] dispatch failed: ${messageOf(err)}`);
    return res.json({ message: `manageCollection failed: ${messageOf(err)}` });
  }
});

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

// The hidden translation worker reports its answer here, via the broker's worker-only
// submitTranslation GUI tool (which POSTs { sessionId, translations }). We hand the
// array to the waiting request and let translateViaHiddenChat validate it.
app.post("/api/translation/submit", (req, res) => {
  const { sessionId, translations } = isRecord(req.body) ? req.body : {};
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  // No in-flight request for this id (already settled / timed out / not a worker).
  if (!submitTranslation(sessionId, translations)) {
    return res.status(404).json({ error: "no pending translation for this session" });
  }
  return res.json({ ok: true });
});

// In-process GUI MCP server, served over Streamable HTTP. claude (wired up via
// mcpConfigJson) POSTs JSON-RPC here; the session id is in the URL path. We run in
// STATELESS mode (sessionIdGenerator: undefined): one fresh Server+transport per
// request, no session header / no initialize handshake required across requests.
// The SDK forbids reusing a stateless transport, so we never cache it.
const mcpReject = (_req: express.Request, res: express.Response) => res.status(405).set("Allow", "POST").json({ error: "method not allowed" });
app.post("/api/mcp/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  // Hidden translation workers (and only they) get the worker-only submitTranslation
  // tool, so a normal chat's tool list stays clean.
  const server = buildGuiMcpServer(sessionId, `http://127.0.0.1:${PORT}`, { submitTranslationTool: translationWorkerIds.has(sessionId) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(`[mcp] request failed for ${sessionId}:`, err);
    if (!res.headersSent) res.status(500).json({ error: "mcp error" });
  }
});
// No SSE stream / session teardown in stateless mode — reject the rest.
app.get("/api/mcp/:sessionId", mcpReject);
app.delete("/api/mcp/:sessionId", mcpReject);

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

// SPA fallback for vue-router history mode: a hard reload / deep-link of a client
// route (e.g. /terminals, /collections/foo) must serve index.html. Mounted AFTER
// express.static so real asset files win, and after the /artifacts/html preview
// route (registered above) so it wins too. SPA_FALLBACK_RE reserves the single /api
// prefix — see server/spa-fallback.ts for why that's sufficient.
app.get(SPA_FALLBACK_RE, (_req, res) => res.sendFile(path.join(__dirname, "../dist/index.html")));

// Activity hooks update a session's working / needs-attention flags. `active` (this
// session is the user's actively-viewed pane) suppresses the attention flag — see
// activityHookEffects for why a mere attached socket doesn't count in the grid.
function handleActivityHook(sessionId: string, event: string, active: boolean, message: string) {
  for (const eff of activityHookEffects(event, active)) {
    if (eff.kind === "working") setWorking(sessionId, eff.value, event);
    else setWaiting(sessionId, eff.value, event);
  }
  // Push regardless of `active` — the phone is elsewhere, unlike the attention beep.
  // A finished turn (Stop) and a blocked one (Notification) both reach here; the kind
  // decides the wording. Stop is one event per finished turn, so this fires once even
  // though a background Stop publishes twice.
  const kind = pushKindFor(event);
  if (kind) notifyTaskFinished(sessionId, kind, message);
}

const PUSH_TITLE_MAX = 80;
const PUSH_BODY_MAX = 160;
// Which port this host's UI answers on, so a receiver can open it instead of guessing.
// Express serves the built SPA on PORT; under `yarn dev` the UI is Vite's own server, whose
// port the backend only knows when CLIENT_PORT is set in its environment (vite.config.ts
// defaults it separately). Reaching it still requires a receiver on this machine — see the
// data payload below.
const UI_PORT = String(process.env.CLIENT_PORT || PORT);
// Notify the user's devices that a background task finished, when Web Push is enabled.
// Fire-and-forget; sendWebPush no-ops when RemoteHost (its Firebase auth) isn't connected.
function notifyTaskFinished(sessionId: string, kind: PushKind, message: string): void {
  if (!getPushEnabled()) return;
  // Internal helper turns flow through /api/hook with active=false too — hidden background
  // workers and translation workers aren't real user tasks, so never push for them.
  if (hiddenSessions.has(sessionId) || translationWorkerIds.has(sessionId)) return;
  const cwd = ptys.get(sessionId)?.cwd ?? null;
  const where = cwd ? path.basename(cwd) : "session";
  // A finished turn should say what the agent DID — the prompt is what the user already
  // knows, and reading it back tells them nothing about the outcome. Read it HERE instead
  // of taking `lastResponses`: publishActivity skips its refresh for an actively-viewed
  // session (no `waiting` flag) while the push still fires, and the cache deliberately
  // survives a failed read — either way the map can hold the previous turn's reply, which
  // is worse than saying nothing. No reply to read falls through to the prompt.
  const reply = kind === "finished" && cwd ? readLatestResponse(sessionId, cwd) : null;
  if (reply) lastResponses.set(sessionId, reply); // keep the roster in step; we just read it
  const detail = (reply ?? "").trim() || lastPrompts.get(sessionId) || aiTitles.get(sessionId) || "";
  const { title, body } = buildPushText(kind, where, detail, message, { title: PUSH_TITLE_MAX, body: PUSH_BODY_MAX });
  // The session id is what lets the phone open this session from the notification;
  // the host id is what lets it know WHOSE session. Without it the phone opens with
  // no host selected — it never persists one — and can only offer the picker, which
  // is where every notification tap used to land (receptron/mulmoserver#86).
  // `port` is for a receiver running ON this machine, which can then open the local UI
  // directly (http://localhost:<port>). A phone cannot use it — its own localhost is the
  // phone — so the receiver has to treat it as optional and keep the existing routing.
  void sendWebPush(title, body, { sessionId, hostId: REMOTE_HOST_ID, port: UI_PORT });
}

interface HookToolPayload {
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_response?: unknown;
  duration_ms?: number;
}

// Pre/PostToolUse hooks feed the per-session tool-call history. A failed tool
// fires PostToolUseFailure (NOT PostToolUse), so both complete the entry.
async function handleToolHook(sessionId: string, event: string, p: HookToolPayload) {
  if (event === "PreToolUse") {
    await recordToolCallStart(sessionId, { toolUseId: p.tool_use_id, toolName: p.tool_name, toolInput: p.tool_input });
  } else if (event === "PostToolUse" || event === "PostToolUseFailure") {
    await recordToolCallEnd(sessionId, {
      toolUseId: p.tool_use_id,
      toolName: p.tool_name,
      toolInput: p.tool_input,
      toolOutput: p.tool_output ?? p.tool_response,
      durationMs: p.duration_ms,
      status: event === "PostToolUseFailure" ? "failed" : "completed",
    });
  }
  // A SUCCESSFUL write to <dir>/.mulmoterminal.json is the live-reload signal: the hook that already
  // reports every tool call tells the client to re-read that directory's config, so no fs watchers.
  if (event === "PostToolUse") {
    const cwd = dirConfigWriteTarget(p.tool_name, p.tool_input, ptys.get(sessionId)?.cwd ?? null);
    if (cwd) pubsub?.publish(DIR_CONFIG_CHANNEL, { cwd });
  }
}

// Track the prompt the cell header shows for a session, from a UserPromptSubmit
// hook. On the FIRST live prompt after a (re)start/resume the in-memory baseline is
// empty, so seed it from the transcript's meaningful prompt — otherwise a trivial
// ack ("ok") would overwrite the restored task. (Brand-new sessions have no
// transcript yet => null => the new prompt becomes the first shown.) Then keep the
// last MEANINGFUL prompt (preferredHeaderPrompt) while still tracking the latest for
// an all-trivial session.
async function trackPromptForHeader(sessionId: string, prompt: string, cwd: string | undefined) {
  if (!lastPrompts.has(sessionId)) {
    const seeded = cwd ? await latestUserPrompt(cwd, sessionId) : null;
    if (seeded) lastPrompts.set(sessionId, seeded);
  }
  lastPrompts.set(sessionId, preferredHeaderPrompt(lastPrompts.get(sessionId) ?? null, prompt));
}

// `/clear` restarts the conversation, so the header must stop showing the pre-clear prompt. Blank it
// (empty string beats the `?? transcriptPrompt` fallback in /api/session, so the old transcript can't
// resurface) and publish; the next UserPromptSubmit sets the new query. `forgetTitle` drops the AI title
// so it's regenerated fresh on the next turn (leaving it in `aiTitles` — even as "" — would read as
// "already titled" and suppress that regeneration). The cockpit's last reply is blanked the same way as
// the prompt (empty beats `?? transcriptResponse`) so it can't show the pre-clear answer.
function clearHeaderPrompt(sessionId: string): void {
  lastPrompts.set(sessionId, "");
  lastResponses.set(sessionId, "");
  forgetTitle(sessionId);
  publishActivity(sessionId);
}

// Header-prompt / AI-title side effects of a hook, per event: track the submitted prompt
// (UserPromptSubmit), drop it on `/clear` (SessionStart source=clear), or (re)generate the
// AI title once a turn's reply is on disk (Stop). Kept out of the route so its branching
// doesn't inflate the handler. Runs before handleActivityHook so the activity publish it
// triggers already carries the new lastPrompt.
async function applyHeaderHooks(sessionId: string, event: string, body: Record<string, unknown>, cwd: string | undefined): Promise<void> {
  if (event === "UserPromptSubmit" && typeof body.prompt === "string" && body.prompt.trim()) {
    const prompt = body.prompt.trim().slice(0, LAST_PROMPT_CAP);
    await trackPromptForHeader(sessionId, prompt, cwd);
    noteTitleTurn(sessionId, prompt);
  } else if (event === "SessionStart" && body.source === "clear") {
    clearHeaderPrompt(sessionId);
  } else if (event === "Stop") {
    void maybeGenerateTitle(sessionId, cwd);
  }
}

// Claude hooks (Stop / Notification / Pre|PostToolUse / SessionStart) POST their payload here so
// we can flag which background sessions have new activity / build tool history.
app.post("/api/hook", async (req, res) => {
  const body = req.body || {};
  const sessionId = resolveHookSessionId(req.headers["x-mt-session"], body.session_id, (id) => SESSION_ID_RE.test(id));
  const event = body.hook_event_name;
  if (!sessionId && body.session_id) {
    // Rejecting silently would make hooks look simply broken; the id shape is the
    // precondition for using it as a Firestore doc id and as push routing.
    console.warn(`[hook] ignoring ${event} — session id is not a canonical uuid`);
  }
  if (sessionId) {
    const entry = ptys.get(sessionId);
    const active = !!(entry && entry.active);
    const cwd = typeof body.cwd === "string" ? body.cwd : entry?.cwd;
    await applyHeaderHooks(sessionId, event, body, cwd);
    handleActivityHook(sessionId, event, active, typeof body.message === "string" ? body.message : "");
    await handleToolHook(sessionId, event, body);
    // A hidden translation worker that ends its turn while still pending never called
    // submitTranslation — fail it now rather than hang until the timeout. (When it DID
    // submit, the entry is already resolved and this reject is a no-op.)
    if (event === "Stop") failPendingTranslation(sessionId, "[translation] worker ended its turn without calling submitTranslation");
    console.log(`[hook] ${event} for ${sessionId}`);
  }
  res.json({ ok: true });
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
    spawnClaudePty(sessionId, null, null, message);
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
  spawnClaudePty(sessionId, null, null, message);
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
    spawnClaudePty(sessionId, null, null, message);
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
