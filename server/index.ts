import express from "express";
import http from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import pty from "node-pty";
import type { IPty } from "node-pty";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPubSub } from "./pubsub.js";
import { mountAllRoutes, allowedToolNames, toolSummaries } from "./plugins-registry.js";
import { buildGuiMcpServer } from "./mcp/broker.js";
import { initMarkdownBackend } from "./backends/markdown.js";
import { initArtifactsBackend } from "./backends/artifacts.js";
import { mountConfigRoutes, getPrRepos, getLaunchers, getUserMcpServers, getHeaderConfig } from "./config-routes.js";
import { buildHeaderContext, loadHeaderConfig } from "./header-context.js";
import { resolveHeader, resolveButtonCommand } from "./header-resolve.js";
import { mountFilesBrowseRoutes } from "./files-browse.js";
import { gitStatus } from "./git-status.js";
import { tmuxAvailable, tmuxNewSessionArgs, tmuxHasSession, tmuxKillSession, tmuxListSessionIds } from "./tmux.js";
import {
  sandboxEnabled,
  sandboxPlatformSupported,
  dockerAvailable,
  sandboxImageExists,
  ensureSandboxImage,
  buildDockerRunArgs,
  writeSandboxClaudeConfig,
  writeSandboxCredentials,
  cleanupSandbox,
  rewriteLoopbackForDocker,
  SANDBOX_HOST,
} from "./sandbox.js";
import { listPrsAcrossRepos } from "./prs.js";
import { listIssuesAcrossRepos } from "./issues.js";
import { publicDirConfig, dirSoundFile } from "./dir-config.js";
import { loadScripts, resolveScript } from "./scripts.js";
import { buildClaudeArgs } from "./claude-args.js";
import { claudeAdapter } from "./agents/claude.js";
import { codexAdapter } from "./agents/codex.js";
import { buildCodexArgs } from "./codex-args.js";
import { codexSessionsRoot, snapshotSessions, watchForCodexSession } from "./codex-session.js";
import { listCodexSessions, codexRolloutExists } from "./codex-sessions.js";
import { codexifySkillSeed } from "./codex-skills.js";
import { stripTerminalQueries } from "./terminal-replay.js";
import {
  isRecord,
  parseJsonl,
  userPromptText,
  latestMeaningfulUserPromptFromJsonl,
  preferredHeaderPrompt,
  sessionUsageFromJsonl,
  latestTurnContextFromJsonl,
  timelineFromJsonl,
  type SessionUsage,
  type LatestTurnContext,
  type TimelineEvent,
} from "./transcript.js";
import { mountOpenDirRoute } from "./open-dir.js";
import { mountGitRemoteRoute } from "./gitRemote.js";
import { mountWorktreeRoutes } from "./worktree-routes.js";
import { mountPickFileRoute } from "./pick-file.js";
import { mountCommandSummaryRoute } from "./command-summary.js";
import { mountCostRoute } from "./cost.js";
import { initCollectionsBackend, mountCollectionRoutes } from "./backends/collections.js";
import { mountWikiRoutes } from "./backends/wiki.js";
import { initAccountingBackend, mountAccountingRoutes } from "./backends/accounting.js";
import { initFeedsBackend, mountFeedsRoutes } from "./backends/feeds.js";
import { initRemoteHostBackend, mountRemoteHostRoutes } from "./backends/remoteHost/index.js";
import { feedRefreshTaskDef, type AgentWorkerRunner } from "@mulmoclaude/core/feeds/server";
import { initWorkspaceSetup } from "./backends/workspaceSetup.js";
import { initFileChangePublisher } from "./backends/fileChange.js";
import { initNotifier, mountNotificationRoutes } from "./backends/notifier.js";
import { mountWhisperRoutes, stopWhisperSidecar } from "./backends/whisper.js";
import { startCollectionCompletionWatchers } from "./backends/collectionWatchers.js";
import { initUserTaskScheduler, mountSchedulerRoutes } from "./backends/scheduler.js";
import { mountFilesRoutes } from "./backends/files.js";
import { mountShortcutsRoutes } from "./backends/shortcuts.js";
import { mountTranslationRoutes } from "./backends/translation.js";
import { mountHtmlDispatchRoute, mountHtmlPreviewRoute } from "./backends/html.js";
import { SPA_FALLBACK_RE } from "./spa-fallback.js";

// Per-session activity flags, driven by Claude hooks (see /api/hook).
interface Activity {
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
  at?: number;
}

// A live PTY and its (possibly detached) browser socket.
interface PtyEntry {
  term: IPty;
  ws: WebSocket | null;
  buffer: string;
  cwd: string; // the dir the PTY actually runs in (reported on reattach)
  // True when `term` is a tmux client (persistent): killing it only detaches, so reap
  // must kill the tmux session to actually end the program.
  tmux?: boolean;
  // True when `term` is a `docker run` client (single-view sandbox): reap force-removes
  // the container, since killing the client alone can leave it running.
  sandbox?: boolean;
}

interface KnownSession {
  createdAt: number;
  title: string;
}

// A GUI plugin result, deduped by uuid; the rest of the payload is opaque here.
interface ToolResult {
  uuid: string;
  [key: string]: unknown;
}

// One entry in a session's tool-call history (Pre/PostToolUse hooks).
interface ToolCall {
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  durationMs?: number;
  status: string;
  at: number;
}

// A sidebar session row (resolved from disk or a pending in-memory session).
interface SessionMeta {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
  /** The hook that set the current state (e.g. "Stop" | "Notification"), or null.
   *  Lets the client split `waiting` into "done, unreviewed" (Stop) vs "blocked on
   *  input" (Notification). */
  event: string | null;
  /** Spawned as a hidden background worker (spawnBackgroundChat hidden:true). The
   *  tab still lists, but it never renders bold/unread — a background helper
   *  finishing shouldn't pull the user's attention. */
  hidden: boolean;
}

// Recency rank for an on-disk .jsonl, before its contents are read.
interface DiskStat {
  kind: "disk";
  id: string;
  file: string;
  mtime: number;
}

// An in-memory session not yet persisted to disk.
interface PendingSession extends SessionMeta {
  kind: "pending";
}

// Node fs errors carry a `code` (e.g. "ENOENT"); narrow before reading it.
const hasErrnoCode = (e: unknown): e is { code?: string } => typeof e === "object" && e !== null;

// Error message extracted defensively from an unknown thrown value.
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 34567;
const CLAUDE_BIN = claudeAdapter.bin();
const CODEX_BIN = codexAdapter.bin();
// Model override for codex sessions (--model); null uses codex's own configured default.
const CODEX_MODEL = process.env.CODEX_MODEL || null;
// Permission mode for backend-spawned Claude sessions. Defaults to "auto" so
// the backend runs hands-off; override with CLAUDE_PERMISSION_MODE (e.g.
// "default" / "acceptEdits" / "bypassPermissions" / "plan") when needed.
const CLAUDE_PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "auto";
const CLAUDE_CWD = process.env.CLAUDE_CWD || path.join(os.homedir(), "mulmoclaude");

// CLAUDE_CWD is the workspace used as the PTY cwd and as the root for persisted
// session state, so it must exist before we spawn anything into it.
await fs.mkdir(CLAUDE_CWD, { recursive: true });

// Seed help docs + preset skills so a MulmoTerminal-alone run gets the full
// workspace experience. Gated to the managed mulmoclaude workspace and
// fault-isolated per step, so it never aborts boot (see workspaceSetup.ts).
initWorkspaceSetup({ workspace: CLAUDE_CWD });

// MulmoTerminal's own per-session GUI state (tool-result render data + tool-call
// history) lives here, keyed by sessionId (a global UUID) — NOT under the
// workspace dir, so it stays valid regardless of which directory is active.
const MULMOTERMINAL_HOME = path.join(os.homedir(), ".mulmoterminal");

// Hidden translation-worker sessions run in CLAUDE_CWD — the workspace the user has
// already trusted — because claude blocks on its workspace-trust dialog in any
// untrusted dir (no input ever comes, so the worker would hang). Their session ids
// are tracked here so they're FILTERED OUT of /api/sessions: a translation worker is
// a transient internal helper, not a chat the user should see in the sidebar.
const translationWorkerIds = new Set<string>();

// sessionId → settlers for a hidden translation worker's in-flight request.
// `resolve` is called from POST /api/translation/submit when the worker reports its
// answer (via the submitTranslation GUI tool); `reject` from the Stop hook if the
// worker ends its turn WITHOUT submitting (a misbehaved turn), so we fail fast
// instead of waiting out the full timeout.
const pendingTranslations = new Map<string, { resolve: (translations: string[]) => void; reject: (err: Error) => void }>();

// A session id is always a UUID (server-generated, or a .jsonl basename). Reject
// anything else so a client can't smuggle CLI flags (e.g. "--resume" followed by
// a value that claude re-parses as a flag) into the spawned process.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Session ids that belong to the multi-terminal GRID — dev terminals, spawned with
// gui=0 (no GUI MCP; see the ?gui handling in the WS connection handler). They're
// FILTERED OUT of the chat sidebar's /api/sessions so a grid terminal never surfaces
// as a clickable chat row: selecting it in chat would reattach its live PTY and
// SUPERSEDE the grid cell (the "chat hijacked my multi-terminal session" bug). The
// set is persisted so the exclusion survives a reboot and outlives the live PTY — a
// reaped grid session's on-disk transcript still shouldn't reappear as a chat. NOTE:
// the exclusion applies ONLY to the unscoped (chat) query; the grid's OWN cwd-scoped
// resume picker (/api/sessions?cwd=…) must keep listing these so they stay resumable.
const devTerminalSessions = new Set<string>();
const DEV_TERMINAL_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "dev-terminal-sessions.json");

// Hydrate the set once at boot (best-effort — absent on first run / unreadable =>
// empty). Exposed as a promise so readers/writers can wait for it: a request served
// (or a mark persisted) before this resolves would otherwise see an empty set and
// either leak hidden grid transcripts into chat or clobber the file with a snapshot
// missing the on-disk ids.
const devTerminalSessionsHydrated: Promise<void> = (async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(DEV_TERMINAL_SESSIONS_FILE, "utf8"));
    if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string" && SESSION_ID_RE.test(id)) devTerminalSessions.add(id);
  } catch {
    // no file yet or unreadable => start empty
  }
})();

// Serialize every persist into ONE chain so concurrent marks can't run overlapping
// writeFile()s that interleave and leave an older snapshot on disk (dropping ids).
// Each link waits for hydration first (so it never persists a set missing the on-disk
// ids) and stringifies the CURRENT set at write time, so the last link always writes
// the complete, up-to-date set. A failed write is logged and the chain continues.
let devTerminalPersist: Promise<void> = Promise.resolve();
function persistDevTerminalSessions(): void {
  devTerminalPersist = devTerminalPersist
    .then(() => devTerminalSessionsHydrated)
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.writeFile(DEV_TERMINAL_SESSIONS_FILE, JSON.stringify([...devTerminalSessions])))
    .catch((e) => console.error(`[dev-terminal-sessions] failed to persist: ${messageOf(e)}`));
}

// Record a grid/dev-terminal session id, then persist. A no-op once the id is known,
// so repeated reattaches of the same cell — or a reconnect after a reboot — don't
// rewrite the file.
function markDevTerminalSession(id: string): void {
  if (!SESSION_ID_RE.test(id) || devTerminalSessions.has(id)) return;
  devTerminalSessions.add(id);
  persistDevTerminalSessions();
}

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

// A per-session list store mirrored to disk so it survives a server reboot — one
// JSON file per session under <workspace>/<dirName>/<sessionId>.json
// (<workspace> = CLAUDE_CWD). The in-memory Map is the working copy; the file is
// rewritten on each change and lazy-loaded on first access. Session ids are
// validated UUIDs (SESSION_ID_RE), so they're safe to use as filenames.
function createSessionStore<T>(dirName: string) {
  const dir = path.join(MULMOTERMINAL_HOME, dirName);
  const fileFor = (id: string) => path.join(dir, `${id}.json`);
  const map = new Map<string, T[]>(); // id -> list (the working copy; mutate in place)
  const loading = new Map<string, Promise<T[]>>(); // id -> Promise<list>, dedupes concurrent loads

  // Lazily load a session's list from disk, then keep using the in-memory copy.
  function get(sessionId: string): Promise<T[]> {
    const cached = map.get(sessionId);
    if (cached) return Promise.resolve(cached);
    const inflight = loading.get(sessionId);
    if (inflight) return inflight;
    const p = (async () => {
      let list: T[] = [];
      if (SESSION_ID_RE.test(sessionId)) {
        try {
          const parsed = JSON.parse(await fs.readFile(fileFor(sessionId), "utf8"));
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          // No file yet (or unreadable) => start empty.
        }
      }
      map.set(sessionId, list);
      loading.delete(sessionId);
      return list;
    })();
    loading.set(sessionId, p);
    return p;
  }

  // Persist a session's list (best-effort, fire-and-forget).
  async function save(sessionId: string) {
    if (!SESSION_ID_RE.test(sessionId)) return;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fileFor(sessionId), JSON.stringify(map.get(sessionId) || []));
    } catch (e) {
      console.error(`[${dirName}] failed to persist ${sessionId}: ${messageOf(e)}`);
    }
  }

  return { get, save };
}

// GUI toolResults per session, persisted under ~/.mulmoterminal/toolresults so
// the panel replays the rendered views even after a server reboot. (Chat +
// message history live in the terminal and Claude's .jsonl; this is the GUI-side
// store.) Each entry is an array of toolResults, capped to the most recent N.
const toolResultsStore = createSessionStore<ToolResult>("toolresults");
const GUI_HISTORY_LIMIT = 50;

// Upsert a toolResult into a session's list, deduped by uuid — a re-emitted result
// (e.g. a form whose viewState changed after the user submitted) updates in place.
// Mirrors MulmoClaude's applyToolResultToSession.
async function storeToolResult(sessionId: string, result: ToolResult) {
  const list = await toolResultsStore.get(sessionId);
  const idx = list.findIndex((r) => r.uuid === result.uuid);
  if (idx >= 0) {
    list[idx] = result;
  } else {
    list.push(result);
    if (list.length > GUI_HISTORY_LIMIT) list.splice(0, list.length - GUI_HISTORY_LIMIT);
  }
  toolResultsStore.save(sessionId);
}

// Per-session tool-call history, fed by Claude's PreToolUse/PostToolUse hooks so
// it captures EVERY tool call — built-ins (Bash, Read, …), the user's MCP tools,
// AND our GUI plugin tools — not just the GUI ones the broker sees. Published on a
// per-session channel the tools pane subscribes to. (The broker's toolResults
// store above is separate; it only drives rendering of GUI views.)
//
// Persisted under ~/.mulmoterminal/toolcalls via the same disk-backed store as
// the toolResults, so the history survives a server reboot.
const toolCallsStore = createSessionStore<ToolCall>("toolcalls");
const TOOLCALLS_LIMIT = 200;
const toolCallsChannel = (id: string) => `toolcalls:${id}`;
// Stored tool outputs are capped so one verbose tool can't bloat the on-disk
// history (and the pane). The raw output still reaches the LLM via the terminal;
// this is only the history copy.
const TOOL_OUTPUT_CAP = 20_000;

function capToolOutput(output: unknown): unknown {
  if (typeof output === "string" && output.length > TOOL_OUTPUT_CAP) {
    return output.slice(0, TOOL_OUTPUT_CAP) + `\n… (truncated ${output.length - TOOL_OUTPUT_CAP} chars)`;
  }
  return output;
}

// PreToolUse: a tool started. Append a "running" entry (deduped by tool_use_id).
async function recordToolCallStart(sessionId: string, { toolUseId, toolName, toolInput }: { toolUseId?: string; toolName?: string; toolInput?: unknown }) {
  const list = await toolCallsStore.get(sessionId);
  if (toolUseId && list.some((c) => c.toolUseId === toolUseId)) return;
  const call = { toolUseId, toolName, toolInput, status: "running", at: Date.now() };
  list.push(call);
  if (list.length > TOOLCALLS_LIMIT) list.splice(0, list.length - TOOLCALLS_LIMIT);
  pubsub?.publish(toolCallsChannel(sessionId), call);
  toolCallsStore.save(sessionId);
}

// PostToolUse (status "completed") or PostToolUseFailure (status "failed"):
// complete the matching entry by tool_use_id (or add one if we never saw the
// start). A failed tool fires PostToolUseFailure, NOT PostToolUse, so both route
// here — otherwise the entry would be stuck on "running".
async function recordToolCallEnd(
  sessionId: string,
  {
    toolUseId,
    toolName,
    toolInput,
    toolOutput,
    durationMs,
    status,
  }: {
    toolUseId?: string;
    toolName?: string;
    toolInput?: unknown;
    toolOutput?: unknown;
    durationMs?: number;
    status: string;
  },
) {
  const list = await toolCallsStore.get(sessionId);
  const output = capToolOutput(toolOutput);
  let call = toolUseId ? list.find((c) => c.toolUseId === toolUseId) : undefined;
  if (call) {
    call.status = status;
    call.toolOutput = output;
    call.durationMs = durationMs;
  } else {
    call = { toolUseId, toolName, toolInput, toolOutput: output, status, at: Date.now(), durationMs };
    list.push(call);
    if (list.length > TOOLCALLS_LIMIT) list.splice(0, list.length - TOOLCALLS_LIMIT);
  }
  pubsub?.publish(toolCallsChannel(sessionId), call);
  toolCallsStore.save(sessionId);
}

// Only the most-recent N sessions are listed in the sidebar; older ones aren't
// read or parsed, keeping /api/sessions cheap for projects with many sessions.
const SESSION_LIST_LIMIT = 50;

// Per-session "working" state, driven by Claude hooks (see /api/hook):
// UserPromptSubmit => Claude started thinking; Stop => it finished.
const activity = new Map<string, Activity>(); // id -> { working, event, at }

// Latest MEANINGFUL user prompt per session (from the UserPromptSubmit hook), shown
// on the grid cell header so you can tell at a glance what each terminal is about. A
// trivial ack ("ok", "merge") doesn't replace it (see the hook handler), so a short
// follow-up can't hide the task.
const lastPrompts = new Map<string, string>(); // id -> prompt text
const LAST_PROMPT_CAP = 200;

// Live ptys keyed by session id. A pty outlives its WebSocket while the session
// is still "working", so switching away doesn't interrupt Claude mid-turn; it
// is reaped once the session goes idle (Stop hook) or the process exits. `ws`
// is null while the session runs in the background.
const ptys = new Map<string, PtyEntry>(); // id -> { term, ws, buffer }

// mulmoterminal session key -> the codex rollout id it maps to. codex mints its own id, so we
// discover it after spawn and keep it here to `codex resume <id>` once the live PTY is gone.
const codexRolloutIds = new Map<string, string>();
// Rollout files already attributed to a session, so a single rollout is never mapped to two keys
// (which would let both cold-resume the same conversation). Serialized by the single event loop.
const claimedCodexRollouts = new Set<string>();

// New sessions started in this process that have no .jsonl on disk yet (Claude
// only writes the file on the first prompt). Merged into /api/sessions so a
// freshly created session shows in the sidebar immediately. An entry is dropped
// once the file exists (the on-disk record takes over) or the pty is reaped.
const knownSessions = new Map<string, KnownSession>(); // id -> { createdAt, title }

// Sessions spawned as hidden background workers (spawnBackgroundChat hidden:true).
// They list normally but never render bold/unread. Process-lifetime only (not
// persisted) — and tied to `activity`'s lifecycle in reap() so a finished hidden
// worker that stays `waiting` doesn't lose its hidden flag and re-bold.
const hiddenSessions = new Set<string>(); // id

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
// short grace — that's the "auto-close inactive ones" behaviour.
function armReapForDetached(id: string) {
  const entry = ptys.get(id);
  if (!entry || entry.ws) return; // still attached: nothing to reap
  // Recompute from scratch: state may have escalated (idle -> waiting) since the
  // last arm, and a stale short timer must not survive to reap a session that now
  // needs the user. cancelReap clears it so scheduleReap re-arms with the right grace.
  cancelReap(id);
  const a = activity.get(id);
  if (a?.working) {
    console.log(`[pty] keeping working session ${id} alive (detached)`);
    return;
  }
  scheduleReap(id, a?.waiting ? WAIT_REAP_GRACE_MS : REAP_GRACE_MS);
}

function reap(id: string) {
  cancelReap(id);
  const entry = ptys.get(id);
  if (!entry) return; // already reaped
  ptys.delete(id);
  // An unpersisted new session vanishes with its pty; a persisted one stays
  // visible via its on-disk record.
  knownSessions.delete(id);
  lastPrompts.delete(id); // don't leak prompt text for torn-down sessions
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

// Publish a session's current activity (working + waiting) to subscribers.
function publishActivity(id: string) {
  const a = activity.get(id) || {};
  pubsub?.publish(SESSIONS_CHANNEL, {
    id,
    // The session's working dir, so the attention-sound player can pick up that
    // directory's custom sound (<cwd>/.mulmoterminal.json). Null for a session with
    // no live PTY (a reaped background worker).
    cwd: ptys.get(id)?.cwd ?? null,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    event: a.event ?? null,
    lastPrompt: lastPrompts.get(id) ?? null,
  });
}

// Claude is thinking (UserPromptSubmit) until it finishes (Stop). No-op (and no
// publish) when the state is unchanged.
function setWorking(id: string, working: boolean, event?: string) {
  const prev = activity.get(id) || {};
  if ((prev.working ?? false) === working) return;
  activity.set(id, { ...prev, working, event: event ?? prev.event ?? null, at: Date.now() });
  publishActivity(id);

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
function hookSettingsJson(host: string = "localhost") {
  const cmd = `curl -s -X POST http://${host}:${PORT}/api/hook ` + `-H 'content-type: application/json' -d @- >/dev/null 2>&1`;
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

// Claude stores each project's sessions under ~/.claude/projects/<encoded-cwd>/,
// where the absolute cwd has its "/" and "." characters replaced by "-".
function projectSessionsDir(cwd: string) {
  const encoded = path.resolve(cwd).replace(/[/.]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

// Whether a session has an on-disk transcript (claude only writes it after the
// first prompt) in the given workspace. Determines whether `--resume` will work.
function sessionExistsOnDisk(id: string, cwd: string): boolean {
  return existsSync(path.join(projectSessionsDir(cwd), `${id}.jsonl`));
}

// Validate a client-supplied workspace dir: must be an absolute, existing
// directory. Anything else (relative, missing, a file) falls back to CLAUDE_CWD,
// so a cell can launch a terminal in a chosen dir without trusting raw input.
function resolveWorkspace(cwd: string | null): string {
  if (cwd && path.isAbsolute(cwd)) {
    try {
      if (statSync(cwd).isDirectory()) return cwd;
    } catch {
      // not a dir / doesn't exist — fall through
    }
  }
  return CLAUDE_CWD;
}

// The most recent user prompt from a resumed session's on-disk transcript, so a
// freshly-resumed cell can show its last prompt instead of just the id. null if
// there's no transcript yet (a never-prompted session) or it can't be read.
async function latestUserPrompt(cwd: string, id: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(projectSessionsDir(cwd), `${id}.jsonl`), "utf8");
    return latestMeaningfulUserPromptFromJsonl(raw);
  } catch {
    return null;
  }
}

const EMPTY_USAGE: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
const EMPTY_CONTEXT: LatestTurnContext = { model: null, contextTokens: 0 };
interface SessionSummary {
  lastPrompt: string | null;
  usage: SessionUsage;
  context: LatestTurnContext;
}
// One read of a session's transcript → its latest prompt, cumulative token usage, and
// current-turn context, so /api/session/:id doesn't parse the .jsonl more than once.
async function readSessionSummary(cwd: string, id: string): Promise<SessionSummary> {
  try {
    const raw = await fs.readFile(path.join(projectSessionsDir(cwd), `${id}.jsonl`), "utf8");
    return { lastPrompt: latestMeaningfulUserPromptFromJsonl(raw), usage: sessionUsageFromJsonl(raw), context: latestTurnContextFromJsonl(raw) };
  } catch {
    return { lastPrompt: null, usage: EMPTY_USAGE, context: EMPTY_CONTEXT };
  }
}

// The tool-activity timeline for a session, capped to the most recent events so the
// payload stays bounded on a long session. A missing transcript is an empty list.
const TIMELINE_MAX_EVENTS = 300;
async function sessionTimeline(cwd: string, id: string): Promise<{ events: TimelineEvent[]; truncated: boolean }> {
  try {
    const raw = await fs.readFile(path.join(projectSessionsDir(cwd), `${id}.jsonl`), "utf8");
    const all = timelineFromJsonl(raw);
    return { events: all.slice(-TIMELINE_MAX_EVENTS), truncated: all.length > TIMELINE_MAX_EVENTS };
  } catch {
    return { events: [], truncated: false };
  }
}

// Scan a session JSONL for a human-friendly title and last activity.
async function readSessionMeta(dir: string, file: string): Promise<SessionMeta> {
  const full = path.join(dir, file);
  const [raw, stat] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);

  let aiTitle: string | null = null;
  let lastPrompt: string | null = null;
  let firstUserMsg: string | null = null;

  for (const o of parseJsonl(raw)) {
    if (o.type === "ai-title" && o.aiTitle) aiTitle = String(o.aiTitle);
    else if (o.type === "last-prompt" && o.lastPrompt) lastPrompt = String(o.lastPrompt);
    else if (o.type === "user" && firstUserMsg === null) {
      firstUserMsg = userPromptText(isRecord(o.message) ? o.message.content : undefined);
    }
  }

  const title = aiTitle || lastPrompt || firstUserMsg || "(untitled session)";
  const id = path.basename(file, ".jsonl");
  const a = activity.get(id);
  return {
    id,
    title,
    mtime: stat.mtimeMs,
    working: a?.working ?? false,
    waiting: a?.waiting ?? false,
    event: a?.event ?? null,
    hidden: hiddenSessions.has(id),
  };
}

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
// sidebar. translateViaHiddenChat is a hoisted function declaration defined alongside
// spawnClaudePty below.
mountTranslationRoutes(app, { workspace: CLAUDE_CWD, translateBatch: translateViaHiddenChat });

// The hidden translation worker reports its answer here, via the broker's worker-only
// submitTranslation GUI tool (which POSTs { sessionId, translations }). We hand the
// array to the waiting request and let translateViaHiddenChat validate it.
app.post("/api/translation/submit", (req, res) => {
  const { sessionId, translations } = isRecord(req.body) ? req.body : {};
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  const pending = pendingTranslations.get(sessionId);
  if (!pending) {
    // No in-flight request for this id (already settled / timed out / not a worker).
    return res.status(404).json({ error: "no pending translation for this session" });
  }
  pending.resolve(Array.isArray(translations) ? (translations as string[]) : []);
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

// Activity hooks update a session's working / needs-attention flags.
// `foreground` (a ws is attached => being viewed) suppresses the attention flag.
function handleActivityHook(sessionId: string, event: string, foreground: boolean) {
  if (event === "UserPromptSubmit") {
    setWorking(sessionId, true, event);
  } else if (event === "Stop") {
    // A background session that finished a turn has output the user hasn't seen
    // yet (and is ready for another message) — flag it for attention.
    if (!foreground) setWaiting(sessionId, true, event);
    setWorking(sessionId, false, event);
  } else if (event === "Notification") {
    // Background session waiting for input (permission / question / idle).
    if (!foreground) setWaiting(sessionId, true, event);
  }
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
// resurface) and publish; the next UserPromptSubmit sets the new query.
function clearHeaderPrompt(sessionId: string): void {
  lastPrompts.set(sessionId, "");
  publishActivity(sessionId);
}

// Claude hooks (Stop / Notification / Pre|PostToolUse / SessionStart) POST their payload here so
// we can flag which background sessions have new activity / build tool history.
app.post("/api/hook", async (req, res) => {
  const body = req.body || {};
  const sessionId = body.session_id;
  const event = body.hook_event_name;
  if (sessionId) {
    const entry = ptys.get(sessionId);
    const foreground = !!(entry && entry.ws);
    // Update the displayed prompt BEFORE handleActivityHook so the activity publish
    // it triggers already carries the new lastPrompt.
    if (event === "UserPromptSubmit" && typeof body.prompt === "string" && body.prompt.trim()) {
      const cwd = typeof body.cwd === "string" ? body.cwd : entry?.cwd;
      await trackPromptForHeader(sessionId, body.prompt.trim().slice(0, LAST_PROMPT_CAP), cwd);
    }
    // `/clear` fires SessionStart with source "clear" — drop the stale header prompt (not "resume"/"compact").
    // Log source + whether the id maps to a live PTY, to confirm /clear keeps the launched --session-id.
    if (event === "SessionStart") {
      console.log(`[hook] SessionStart source=${body.source} id=${sessionId} livePty=${ptys.has(sessionId)}`);
      if (body.source === "clear") clearHeaderPrompt(sessionId);
    }
    handleActivityHook(sessionId, event, foreground);
    await handleToolHook(sessionId, event, body);
    // A hidden translation worker that ends its turn while still pending never called
    // submitTranslation — fail it now rather than hang until the timeout. (When it DID
    // submit, the entry is already resolved and this reject is a no-op.)
    if (event === "Stop") pendingTranslations.get(sessionId)?.reject(new Error("[translation] worker ended its turn without calling submitTranslation"));
    console.log(`[hook] ${event} for ${sessionId}`);
  }
  res.json({ ok: true });
});

// The GUI toolResult sink. Two callers POST here:
//   - the MCP broker, after a plugin produces a result (data gates rendering);
//   - the GUI panel, to persist a plugin view's state change (e.g. a submitted
//     form's viewState) under the same uuid.
// We store the result keyed by session id and publish it on that session's channel
// so the active panel renders/updates it live. Mirrors MulmoClaude's internal
// toolResult route + applyToolResultToSession.
app.post("/api/agent/toolResult", async (req, res) => {
  const { sessionId, toolName, uuid } = req.body || {};
  // The session id flows from env (broker) / the client and ends up in a pub/sub
  // channel name — keep it to the known UUID shape.
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  if (typeof toolName !== "string" || !toolName) {
    return res.status(400).json({ error: "invalid toolName" });
  }
  if (typeof uuid !== "string" || !uuid) {
    return res.status(400).json({ error: "invalid uuid" });
  }

  // Store everything except the routing fields; the result itself is the payload
  // the panel renders.
  // `persistOnly` (set by the GUI panel when a view persists its own state change)
  // means: store, but do NOT re-publish on the session channel. Re-publishing would
  // echo the update back to the originating panel as a fresh result, which re-seeds
  // the view and re-emits — an infinite flicker loop. The broker (new tool calls)
  // omits the flag, so its results still publish and render live.
  const result = { ...req.body };
  delete result.sessionId;
  const persistOnly = result.persistOnly === true;
  delete result.persistOnly;
  await storeToolResult(sessionId, result);

  if (!persistOnly) {
    pubsub?.publish(sessionChannel(sessionId), result);
    console.log(`[gui] toolResult ${toolName} for ${sessionId}`);
  }
  res.json({ ok: true });
});

// Replay a session's stored toolResults so the panel can render them when the
// user (re)selects that session. Loads from disk (~/.mulmoterminal/toolresults) on
// first access so the views survive a reboot.
app.get("/api/agent/toolResults/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  res.json({ sessionId, toolResults: await toolResultsStore.get(sessionId) });
});

// The GUI plugin tools available this session (for the tools pane's "Available
// Tools" list). The full set claude can call — built-ins, other MCP — is not
// enumerable server-side; those still show up in the tool-call history below.
app.get("/api/tools", (_req, res) => {
  res.json({ tools: toolSummaries });
});

// Replay a session's tool-call history (every tool, via the Pre/PostToolUse hooks)
// so the tools pane can render it when the user (re)selects that session. Loads
// from disk (~/.mulmoterminal/toolcalls) on first access so it survives a reboot.
app.get("/api/tool-calls/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  res.json({ sessionId, toolCalls: await toolCallsStore.get(sessionId) });
});

// GET/POST /api/config (workspace dir + directory presets) — in its own module.
// GRID-ONLY (dev_tool): backs the grid launcher's default dir + the settings
// modal's directory presets. The single view never calls it.
mountConfigRoutes(app, CLAUDE_CWD);

// Project-scoped file browsing + editing for the full-screen Files view
// (GET /api/files/browse/{list,text,md}, PUT .../write — all ?cwd=&path=). Each
// terminal browses its own session's project dir; paths are contained within it.
mountFilesBrowseRoutes(app, { defaultCwd: CLAUDE_CWD });

// Cross-repo PR list (the /prs view): aggregate open PRs for the configured repos via
// the server's `gh` login. Repos come from config (never the request).
app.get("/api/prs", async (_req, res) => {
  try {
    res.json({ repos: await listPrsAcrossRepos(getPrRepos()) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Sibling of /api/prs: the same configured repos' open issues (capped per repo).
app.get("/api/issues", async (_req, res) => {
  try {
    res.json({ repos: await listIssuesAcrossRepos(getPrRepos()) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GRID-ONLY (dev_tool): the `script.json` entries a cell's launcher offers for its
// chosen directory (?cwd=<dir>, falling back to CLAUDE_CWD). The browser shows
// these and sends back only an INDEX + the cwd (see /ws/run), so the file is the
// allowlist of what can run. The resolved `cwd` is returned so the cell runs the
// script in the same dir it listed scripts for.
app.get("/api/scripts", (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  res.json({ cwd, scripts: loadScripts(cwd).map((s, index) => ({ index, label: s.label, command: s.command, cwd: s.cwd })) });
});

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

// GRID-ONLY (dev_tool): initial per-session status + last prompt, so a grid cell
// can render its header immediately (live updates then arrive via the "sessions"
// pub/sub channel). The single view reads activity straight from that channel.
// ?cwd= locates the transcript so a freshly-resumed session shows its most recent
// prompt; the live in-memory prompt (this process run) takes precedence.
app.get("/api/session/:id", async (req, res) => {
  const { id } = req.params;
  if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  const a = activity.get(id) || {};
  const { lastPrompt: transcriptPrompt, usage, context } = await readSessionSummary(cwd, id);
  const lastPrompt = lastPrompts.get(id) ?? transcriptPrompt;
  res.json({
    id,
    cwd,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    event: a.event ?? null,
    lastPrompt,
    usage,
    context,
  });
});

// Per-directory overrides (<cwd>/.mulmoterminal.json): the badge/name/theme a
// terminal opened in this directory should use. cwd is validated like every other
// cwd-scoped route; the raw sound path stays server-side (see /api/dir-sound).
app.get("/api/dir-config", (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  res.json(publicDirConfig(cwd));
});

// Live git status (branch / dirty / ahead·behind) for a terminal's dir, so the
// header can show it without the user typing `git status`. A non-git dir is
// `repo:false`, not an error.
app.get("/api/git-status", async (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  res.json(await gitStatus(cwd));
});

// The resolved terminal-header config (buttons + chips) for a session: global config merged with the
// dir's, with `when` evaluated and ${vars} substituted for this session's live context. `chips:null`
// means unconfigured, so the client keeps its default header (see plans/feat-header-toolbar-config.md).
app.get("/api/header", async (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  const session = typeof req.query.session === "string" && SESSION_ID_RE.test(req.query.session) ? req.query.session : null;
  const agent = req.query.agent === "codex" ? "codex" : "claude";
  const model = typeof req.query.model === "string" ? req.query.model : null;
  const config = loadHeaderConfig(cwd, getHeaderConfig());
  const context = await buildHeaderContext(cwd, { session, agent, model });
  res.json(resolveHeader(config, context));
});

// The tool-activity timeline for a session (what the agent ran, newest last), so a
// cell can show "what did it do?" without scrolling the raw transcript.
app.get("/api/transcript/timeline", async (req, res) => {
  const { session } = req.query;
  if (typeof session !== "string" || !SESSION_ID_RE.test(session)) return res.status(400).json({ error: "invalid session id" });
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  res.json(await sessionTimeline(cwd, session));
});

// Stream a directory's custom attention sound. The path never comes from the
// request — it's read from that dir's .mulmoterminal.json and confined to the dir —
// so there's no traversal surface. 404 when unset/missing (the client falls back to
// the global sound, then the built-in chime).
app.get("/api/dir-sound", (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  const file = dirSoundFile(cwd);
  if (!file) return res.status(404).end();
  // dotfiles:"allow" — the conventional location is a hidden <cwd>/.mulmoterminal/
  // dir, which send() would otherwise 404. The path is already confined to cwd, so
  // serving from a dot-segment is safe here.
  res.sendFile(file, { dotfiles: "allow" }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Cheap recency pass: stat (don't read) every session file just for its mtime, so the
// list can be ranked by recency. Files that vanished between readdir and stat are skipped.
async function collectOnDiskSessionStats(dir: string, files: string[]): Promise<DiskStat[]> {
  const stats = await Promise.all(
    files.map(async (file): Promise<DiskStat | null> => {
      try {
        const st = await fs.stat(path.join(dir, file));
        return { kind: "disk", id: path.basename(file, ".jsonl"), file, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  return stats.filter((s): s is DiskStat => s !== null);
}

// In-memory sessions not yet written to disk. Prune (delete from knownSessions) any that
// have since been persisted — the on-disk record (with its real title) wins.
function collectPendingSessions(onDisk: Set<string>, includePending: boolean): PendingSession[] {
  const pending: PendingSession[] = [];
  for (const [id, meta] of includePending ? knownSessions : []) {
    if (onDisk.has(id)) {
      knownSessions.delete(id);
      continue;
    }
    pending.push({
      kind: "pending",
      id,
      title: meta.title,
      mtime: meta.createdAt,
      working: activity.get(id)?.working ?? false,
      waiting: activity.get(id)?.waiting ?? false,
      event: activity.get(id)?.event ?? null,
      hidden: hiddenSessions.has(id),
    });
  }
  return pending;
}

// List the chat sessions for the current project (CLAUDE_CWD), including
// newly-created sessions that aren't persisted to disk yet.
app.get("/api/sessions", async (req, res) => {
  try {
    // Optional ?cwd= scopes the list to that project's on-disk sessions (the grid
    // cell's resume picker). Without it, the classic single view's behavior is
    // unchanged: CLAUDE_CWD + in-memory pending sessions.
    const cwdParam = typeof req.query.cwd === "string" ? req.query.cwd : null;
    const cwd = cwdParam ? resolveWorkspace(cwdParam) : CLAUDE_CWD;
    const includePending = !cwdParam;
    // Wait for the persisted grid-session set before filtering (below), so a chat
    // request racing server boot can't leak previously-hidden grid transcripts.
    if (includePending) await devTerminalSessionsHydrated;
    const dir = projectSessionsDir(cwd);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (!hasErrnoCode(err) || err.code !== "ENOENT") throw err;
    }

    const onDiskStats = await collectOnDiskSessionStats(dir, files);
    const onDisk = new Set(onDiskStats.map((s) => s.id));
    // Pending is skipped for a cwd-scoped query (pending sessions aren't tracked per dir).
    const pending = collectPendingSessions(onDisk, includePending);

    // Keep only the most-recent N, then read & parse contents for just those
    // on-disk files (a deleted/corrupt file is dropped, not fatal). Hidden translation
    // workers are dropped first — they're transient internal helpers, not user chats.
    const top = [...onDiskStats, ...pending]
      .filter((s) => !translationWorkerIds.has(s.id))
      // Hide multi-terminal GRID sessions from the CHAT sidebar (the unscoped query
      // only). The grid's own resume picker passes ?cwd= (includePending=false) and
      // must keep listing them, so gate the exclusion on includePending.
      .filter((s) => !includePending || !devTerminalSessions.has(s.id))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, SESSION_LIST_LIMIT);
    const sessions = (
      await Promise.all(
        top.map((s) =>
          s.kind === "pending"
            ? { id: s.id, title: s.title, mtime: s.mtime, working: s.working, waiting: s.waiting, event: s.event, hidden: s.hidden }
            : readSessionMeta(dir, s.file).catch(() => null),
        ),
      )
    )
      .filter((s): s is SessionMeta => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ cwd, sessions });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

// codex's own sessions for a workspace (?cwd=, default CLAUDE_CWD), read from ~/.codex rollouts —
// the single view's sidebar lists these so past codex conversations are switchable + resumable.
app.get("/api/codex/sessions", async (req, res) => {
  try {
    const cwdParam = typeof req.query.cwd === "string" ? req.query.cwd : null;
    const cwd = cwdParam ? resolveWorkspace(cwdParam) : CLAUDE_CWD;
    const sessions = await listCodexSessions(codexSessionsRoot(), cwd, SESSION_LIST_LIMIT);
    res.json({ cwd, sessions });
  } catch (err) {
    console.error("[api] /api/codex/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
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

// Configure the collection engine against the shared workspace (CLAUDE_CWD). The
// path layout matches MulmoClaude's so discovery sees the same collection skills.
initCollectionsBackend({ workspace: CLAUDE_CWD });

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
initRemoteHostBackend({ workspace: CLAUDE_CWD, spawnChat: remoteHostSpawnChat });

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
function spawnScheduledChat(message: string): void {
  const sessionId = randomUUID();
  try {
    spawnClaudePty(sessionId, null, null, message);
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
  initUserTaskScheduler({
    workspace: CLAUDE_CWD,
    spawnChat: spawnScheduledChat,
    systemTasks: [feedRefreshTaskDef({ workspaceRoot: CLAUDE_CWD })],
  });
} catch (err) {
  console.error("[scheduler] init failed (non-fatal)", err);
}

// Terminal WebSocket. Uses noServer + manual upgrade routing so it shares the
// HTTP server with socket.io (the pub/sub at /ws/pubsub) without the two
// libraries fighting over the "upgrade" event.
const wss = new WebSocketServer({ noServer: true });
// Command terminals (the grid's Run menu) get their own WS so the plain-command
// PTY relay stays clear of the session/hook/transcript machinery on /ws.
const runWss = new WebSocketServer({ noServer: true });
// Launcher terminals (a plain shell / codex / any configured command) get their own WS
// too. Unlike /ws/run these are PERSISTENT & reattachable (they share the /ws session
// lifecycle — ptys map, reattach, reap grace) but carry no Claude hooks/transcript.
const runLaunchWss = new WebSocketServer({ noServer: true });
// First-class codex sessions — persistent + reattachable like /ws/launch, but running codex
// with session discovery + resume. Its own endpoint so /ws stays claude-only.
const runCodexWss = new WebSocketServer({ noServer: true });
function wssForPath(pathname: string): WebSocketServer | null {
  if (pathname === "/ws") return wss;
  if (pathname === "/ws/run") return runWss;
  if (pathname === "/ws/launch") return runLaunchWss;
  if (pathname === "/ws/codex") return runCodexWss;
  return null; // e.g. /ws/pubsub — left to socket.io's own upgrade handler
}
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const target = wssForPath(pathname);
  if (!target) return;
  if (!isAllowedOrigin(req.headers.origin)) {
    console.warn(`[ws] rejected cross-origin upgrade from ${req.headers.origin}`);
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

// Reattach a live background PTY to a new socket: drop any stale socket, swap in
// the new one, and replay the buffered tail for context.
function reattachPty(entry: PtyEntry, ws: WebSocket, sessionId: string): PtyEntry {
  cancelReap(sessionId); // a reattach within the grace window keeps the session
  console.log(`[ws] reattach ${sessionId} (pid=${entry.term.pid})`);
  // Drop any socket still attached (e.g. the same session open in another tab).
  // Tell it it's been superseded FIRST so it stops instead of auto-reconnecting —
  // otherwise two clients on one session ping-pong (each reattach kicks the other,
  // the kicked one reconnects, …) into a storm.
  if (entry.ws && entry.ws !== ws && entry.ws.readyState === entry.ws.OPEN) {
    try {
      entry.ws.send(JSON.stringify({ type: "superseded" }));
    } catch {
      // socket already going away — closing below is enough
    }
    entry.ws.close();
  }
  entry.ws = ws;
  if (entry.buffer && ws.readyState === ws.OPEN) {
    // Strip terminal queries from the replay so xterm doesn't re-answer them as stray input
    // (e.g. a DA reply surfacing as "0;276;0c" in the prompt) — see terminal-replay.ts.
    ws.send(JSON.stringify({ type: "output", data: stripTerminalQueries(entry.buffer) }));
  }
  return entry;
}

// How long to wait for a hidden translation worker to call submitTranslation before
// giving up (cold claude startup + one short turn). Generous; the result is cached.
const TRANSLATION_TIMEOUT_MS = 120_000;

// Tear down a finished/failed translation worker: kill any lingering pty and drop its
// bookkeeping + transcript so the activity maps and the workspace don't accumulate
// throwaway translation sessions.
function cleanupTranslationWorker(sessionId: string): void {
  reap(sessionId); // idempotent — already reaped if Stop fired
  activity.delete(sessionId);
  hiddenSessions.delete(sessionId);
  translationWorkerIds.delete(sessionId);
  lastPrompts.delete(sessionId);
  pendingTranslations.delete(sessionId);
  fs.rm(path.join(projectSessionsDir(CLAUDE_CWD), `${sessionId}.jsonl`), { force: true }).catch(() => {});
}

// Most a worker request retries before failing. The model occasionally answers in
// text instead of calling submitTranslation (caught fast by the Stop hook); a fresh
// worker almost always succeeds. Misses are cached, so retries are rare in practice.
const TRANSLATION_MAX_ATTEMPTS = 3;

// Run ONE hidden translation worker: spawn it, wait for it to call submitTranslation
// (or fail via the Stop hook / timeout), validate, and tear it down.
async function runTranslationWorkerOnce(prompt: string, expected: number): Promise<string[]> {
  const sessionId = randomUUID();
  hiddenSessions.add(sessionId);
  translationWorkerIds.add(sessionId);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const submitted = new Promise<string[]>((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`[translation] hidden chat timed out after ${TRANSLATION_TIMEOUT_MS}ms`)), TRANSLATION_TIMEOUT_MS);
    pendingTranslations.set(sessionId, { resolve, reject });
  });

  try {
    // ws=null → headless; the worker buffers output nobody reads. Default cwd =
    // CLAUDE_CWD (trusted). submitTranslation (or the Stop hook) settles `submitted`.
    spawnClaudePty(sessionId, null, null, prompt);
    // spawnClaudePty registers a pending session + emits a "created" event; drop the
    // pending entry now so this internal worker never surfaces as a sidebar row (the
    // /api/sessions filter on translationWorkerIds covers its on-disk transcript).
    knownSessions.delete(sessionId);
    const translations = await submitted;
    if (translations.length !== expected || !translations.every((s) => typeof s === "string")) {
      throw new Error(`[translation] submitTranslation returned ${translations.length} strings for ${expected} inputs`);
    }
    return translations;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    cleanupTranslationWorker(sessionId);
  }
}

// The injected LLM step for /api/translation. Drives MulmoTerminal's EXISTING hidden
// background chat (spawnClaudePty) — explicitly NOT `claude -p`, which is banned in
// MulmoTerminal. It seeds a headless worker that translates the strings and reports
// them by calling the worker-only `submitTranslation` GUI tool (POST
// /api/translation/submit). Retries a fresh worker if one answers without submitting.
async function translateViaHiddenChat(targetLanguage: string, sentences: readonly string[]): Promise<string[]> {
  const expected = sentences.length;
  const prompt =
    `You are an automated translation service. Translate each of the ${expected} English strings in ` +
    `the JSON array below into the target language (BCP-47 code: ${targetLanguage}), preserving ` +
    `placeholders like {name}, {count}, %s and any HTML tags verbatim. You MUST deliver the result by ` +
    `calling the submitTranslation tool with a "translations" array of exactly ${expected} strings in ` +
    `the same order — that tool call is the ONLY way to return the result; a text reply is discarded. ` +
    `Do not call any other tool.\n\nInput: ${JSON.stringify(sentences)}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= TRANSLATION_MAX_ATTEMPTS; attempt++) {
    try {
      return await runTranslationWorkerOnce(prompt, expected);
    } catch (err) {
      lastErr = err;
      console.warn(`[translation] attempt ${attempt}/${TRANSLATION_MAX_ATTEMPTS} failed: ${messageOf(err)}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("[translation] hidden chat failed");
}

// Claude must have its input box + bracketed-paste mode up before it will capture a
// typed `draft`; too early and the bytes are echoed into the scrollback instead. We
// wait for its status line to paint (the "shift+tab to cycle" mode hint), settle
// briefly, then type. A fallback fires if that marker never shows (UI string drift).
const DRAFT_READY_MARKER = claudeAdapter.draftReadyMarker;
const DRAFT_SETTLE_MS = 250;
const DRAFT_FALLBACK_MS = 6000;
// Claude's TUI commits a bracketed paste to its input box asynchronously; a CR glued
// onto the same write can arrive before the paste lands and be dropped — leaving an
// auto-run prompt typed-but-unsent. Send the submitting Enter as a SEPARATE chunk a
// beat after the paste so it actually registers.
const DRAFT_SUBMIT_MS = 150;

// Sanitize a draft before typing it into a PTY: strip ALL control bytes (C0/C1 —
// ESC, Ctrl-C, CR/LF, and an embedded bracketed-paste terminator) so untrusted draft
// content can't inject terminal control sequences that break out of the paste and
// submit/interrupt. Only printable text survives, with whitespace collapsed.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const DRAFT_CONTROL_BYTES_RE = /[\u0000-\u001F\u007F-\u009F]+/g;
function sanitizeDraftText(text: string): string {
  return text.replace(DRAFT_CONTROL_BYTES_RE, " ").replace(/\s+/g, " ").trim();
}

// Spawn a fresh claude PTY for this session, register it, and wire its output /
// exit back to the browser socket. `ws` may be null for a session spawned without
// a viewer yet (e.g. spawnBackgroundChat) — output just buffers until a client
// reattaches. `initialPrompt`, when given, is passed to claude as the first turn
// so the session starts working immediately, before anyone opens it. `draft` is the
// opposite: it is NOT auto-submitted — once claude's UI is ready the text is typed
// into the input box (no Enter) so the user can review / edit / send it. Pass one or
// the other, never both.
const PTY_COLS = 120;
const PTY_ROWS = 30;

// pty.spawn with the binary as a PARAMETER (never a string literal at the call site),
// so the tmux/shell/claude spawns aren't flagged as spawn-of-a-string-literal.
function spawnPty(bin: string, args: string[], cwd: string): IPty {
  return pty.spawn(bin, args, { name: "xterm-256color", cols: PTY_COLS, rows: PTY_ROWS, cwd, env: process.env });
}

// Spawn a terminal, wrapping it in a persistent tmux session when tmux is available and
// `persistent` is set, so it survives the server dying. `tmux new-session -A` creates it
// (running file+args) or reattaches the surviving one. Returns whether tmux backs it.
function ptySpawn(sessionId: string, file: string, args: string[], cwd: string, persistent: boolean): { term: IPty; tmux: boolean } {
  if (persistent && tmuxAvailable()) {
    return { term: spawnPty("tmux", tmuxNewSessionArgs(sessionId, file, args, cwd), cwd), tmux: true };
  }
  return { term: spawnPty(file, args, cwd), tmux: false };
}

// Spawn the single-view session inside a Docker container (the sandbox path). Exports the
// host's live Keychain credential so the containerized claude is authenticated — without
// it the container reads a stale/absent ~/.claude/.credentials.json and shows "Not logged in".
function spawnSandboxEntry(sessionId: string, claudeArgs: string[], cwd: string, ws: WebSocket | null): PtyEntry {
  cleanupSandbox(sessionId); // clear any stale container/config/credential with this name
  const claudeConfig = writeSandboxClaudeConfig(sessionId, cwd);
  const credentials = writeSandboxCredentials(sessionId);
  if (credentials === null)
    console.warn("[sandbox] no Claude credential found in the macOS Keychain — the container may be unauthenticated. Run `claude` on the host to log in.");
  const term = spawnPty("docker", buildDockerRunArgs(sessionId, claudeArgs, cwd, claudeConfig, credentials), cwd);
  console.log(`[pty] spawned claude (pid=${term.pid} via docker sandbox) in ${cwd}`);
  return { term, ws, buffer: "", cwd, sandbox: true };
}

// Deliver an auto-run prompt (initialPrompt) or an editable draft by TYPING it into
// claude's input box once it's ready — NOT as a `claude` CLI arg, which a large prompt
// would overflow tmux's `new-session` command-length limit with ("command too long",
// killing the session). ALL control bytes are stripped first — C0/C1, including ESC,
// Ctrl-C, CR/LF and an embedded bracketed-paste terminator (\e[201~) — so untrusted text
// (collection / custom-view) can't inject sequences that break out of the paste. It's
// wrapped in bracketed paste (\e[200~…\e[201~); initialPrompt then presses Enter to run
// it, while a draft gets NO Enter so the user reviews + sends. Returns a scanner to feed
// the pty output to: it types once the input-box readiness marker paints (after a settle),
// or after DRAFT_FALLBACK_MS if the marker never appears (UI drift). No-op when neither.
function attachDraftInjection(entry: PtyEntry, initialPrompt: string | undefined, draft: string | undefined): (data: string) => void {
  const pendingText = draft ?? initialPrompt;
  const autoSubmit = draft === undefined && initialPrompt !== undefined;
  const draftText = pendingText ? sanitizeDraftText(pendingText) : "";
  if (!draftText) return () => {};
  let done = false;
  let scan = "";
  const typeDraft = () => {
    if (done) return;
    done = true;
    try {
      // Type the paste first; for an auto-run, submit with a CR in a SEPARATE write a beat
      // later (DRAFT_SUBMIT_MS) so the Enter isn't dropped while Claude's TUI is still
      // committing the paste. A draft gets no CR — the user reviews + sends.
      entry.term.write(`\x1b[200~${draftText}\x1b[201~`);
      if (autoSubmit) {
        setTimeout(() => {
          try {
            entry.term.write("\r");
          } catch {
            // pty already gone — nothing to submit
          }
        }, DRAFT_SUBMIT_MS);
      }
    } catch {
      // pty already gone — nothing to draft into
    }
  };
  // Fallback: type even if the readiness marker never appears (UI string drift).
  setTimeout(typeDraft, DRAFT_FALLBACK_MS);
  return (data: string) => {
    if (done) return;
    // Type the draft once claude's input box has painted (its mode-hint status line),
    // then settle briefly so the paste lands in the input rather than the scrollback.
    scan = (scan + data).slice(-4096);
    if (DRAFT_READY_MARKER.test(scan)) {
      scan = "";
      setTimeout(typeDraft, DRAFT_SETTLE_MS);
    }
  };
}

// codex's TUI has no stable "input ready" marker (its placeholder rotates), so instead of matching
// a string we wait for its startup output to SETTLE — the boot banner + MCP-boot spinner keep
// emitting until the input prompt is ready, so a quiet gap means codex is waiting for input. Then
// paste the seed + Enter to auto-run it. Same reason as attachDraftInjection: a long prompt can't go
// through tmux's new-session command-length limit ("command too long"). Returns a scanner fed the
// pty output.
const CODEX_READY_QUIET_MS = 1000;
const CODEX_AUTORUN_MAX_WAIT_MS = 15_000;
function attachCodexAutoRun(entry: PtyEntry, prompt: string): (data: string) => void {
  const text = sanitizeDraftText(prompt);
  if (!text) return () => {};
  let done = false;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  const type = () => {
    if (done) return;
    done = true;
    if (quiet) clearTimeout(quiet);
    try {
      entry.term.write(`\x1b[200~${text}\x1b[201~`);
      setTimeout(() => {
        try {
          entry.term.write("\r");
        } catch {
          // pty already gone — nothing to submit
        }
      }, DRAFT_SUBMIT_MS);
    } catch {
      // pty already gone — nothing to type into
    }
  };
  const cap = setTimeout(type, CODEX_AUTORUN_MAX_WAIT_MS);
  return () => {
    if (done) return;
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(() => {
      clearTimeout(cap);
      type();
    }, CODEX_READY_QUIET_MS);
  };
}

function spawnClaudePty(
  sessionId: string,
  resume: string | null,
  ws: WebSocket | null,
  initialPrompt?: string,
  cwd: string = CLAUDE_CWD,
  attachGuiMcp: boolean = true,
  draft?: string,
): PtyEntry {
  // attachGuiMcp picks the MCP mode (see buildClaudeArgs): the single view (default)
  // attaches the GUI MCP + --strict-mcp-config (main's classic behavior); the grid's
  // dev terminals attach neither, so the user's + project's MCP servers load normally.
  // Only --resume when the session has an on-disk transcript — claude doesn't write
  // a session's .jsonl until its first prompt, so a started-but-unused session can't
  // be resumed; we restart fresh (reusing the id via --session-id) instead.
  // Sandbox only the SINGLE-VIEW interactive session: attachGuiMcp=true excludes grid
  // dev terminals (?gui=0), and ws!==null excludes hidden background/translation workers.
  // Falls back to the host spawn if the Docker daemon isn't reachable.
  const sandbox = sandboxEnabled() && sandboxPlatformSupported() && attachGuiMcp && ws !== null && dockerAvailable() && sandboxImageExists();
  const canResume = resume !== null && sessionExistsOnDisk(resume, cwd);
  const args = buildClaudeArgs({
    sessionId,
    resume,
    canResume,
    // In the sandbox the hooks + GUI MCP are reached over host.docker.internal.
    settings: hookSettingsJson(sandbox ? SANDBOX_HOST : "localhost"),
    permissionMode: CLAUDE_PERMISSION_MODE,
    attachGuiMcp,
    mcpConfig: mcpConfigJson(sessionId, sandbox ? SANDBOX_HOST : "127.0.0.1", sandbox),
    // Auto-allow the GUI tools + the user's own configured MCP servers (mcp__<id>), so
    // their tools don't trip a permission prompt on every call.
    guiMcpTools: [GUI_MCP_TOOLS, ...getUserMcpServers().map((s) => `mcp__${s.id}`)].join(","),
  });

  console.log(`[ws] client connected (${canResume ? "resume" : "new"} ${sessionId})`);

  // Sandbox → run claude inside a fresh container (no tmux). Otherwise the host path:
  // a live tmux session for this id (survived a restart) reattaches; else create it.
  let entry: PtyEntry;
  if (sandbox) {
    entry = spawnSandboxEntry(sessionId, args, cwd, ws);
  } else {
    const { term, tmux } = ptySpawn(sessionId, CLAUDE_BIN, args, cwd, true);
    console.log(`[pty] spawned claude (pid=${term.pid}${tmux ? " via tmux" : ""}) in ${cwd}`);
    entry = { term, ws, buffer: "", cwd, tmux };
  }
  ptys.set(sessionId, entry);

  if (!canResume) {
    // Brand-new (or restarted-idle) session: surface it in the sidebar before
    // it's persisted. A spawned session (initialPrompt or a draft) gets a title from
    // that text so it's recognizable in the sidebar before anyone opens it.
    const seed = initialPrompt ?? draft;
    const title = seed ? seed.replace(/\s+/g, " ").trim().slice(0, 60) || "New session" : "New session";
    knownSessions.set(sessionId, { createdAt: Date.now(), title });
    pubsub?.publish(SESSIONS_CHANNEL, { id: sessionId, working: false, event: "created" });
  }

  // The auto-run prompt / editable draft is typed into the input box once ready (see
  // attachDraftInjection) — its scanner is fed the pty output below.
  const scanForDraftReady = attachDraftInjection(entry, initialPrompt, draft);

  // PTY -> browser (buffering a bounded tail for reattach).
  entry.term.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-OUTPUT_BUFFER_LIMIT);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "output", data }));
    }
    scanForDraftReady(data);
  });

  entry.term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] exited code=${exitCode} signal=${signal}`);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      entry.ws.close();
    }
    // Clear the dot if it died mid-turn, then tear down everything (deletes
    // ptys/knownSessions/activity and publishes "closed") so a process that
    // exits on its own — e.g. a brand-new session that never persisted —
    // doesn't linger in the sidebar.
    setWorking(sessionId, false);
    reap(sessionId);
  });

  return entry;
}

// browser -> PTY. The protocol is client-controlled, so validate every frame
// before touching node-pty (bad cols/rows or non-string input can throw).
function handleClientFrame(entry: PtyEntry, ws: WebSocket, raw: RawData, sessionId: string) {
  // Ignore frames from a socket that a newer client has already superseded.
  if (entry.ws !== ws) return;
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return; // not JSON — never write arbitrary payloads to the PTY
  }
  try {
    if (msg.type === "terminate") {
      // Explicit close (the cell's ✕) — reap now instead of waiting out the
      // disconnect grace window, so the session slot frees immediately.
      reap(sessionId);
    } else if (msg.type === "input" && typeof msg.data === "string") {
      entry.term.write(msg.data);
    } else if (
      msg.type === "resize" &&
      Number.isInteger(msg.cols) &&
      Number.isInteger(msg.rows) &&
      msg.cols >= 2 &&
      msg.cols <= 500 &&
      msg.rows >= 1 &&
      msg.rows <= 200
    ) {
      entry.term.resize(msg.cols, msg.rows);
    }
  } catch (err) {
    // e.g. a write/resize that races the PTY exiting — drop it, never crash.
    console.warn(`[ws] dropped message for ${sessionId}: ${messageOf(err)}`);
  }
}

// Run an arbitrary shell command in a PTY and relay its I/O to the browser. Unlike
// spawnClaudePty this is NOT a Claude session — no id, no hooks, no transcript, no
// reap/grace. It's an ephemeral grid terminal (the Run menu); the caller kills it
// when the viewer's socket closes.
function spawnCommandPty(command: string, cwd: string, ws: WebSocket): IPty {
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  const args = isWindows ? ["-NoLogo", "-Command", command] : ["-lc", command];
  const term = pty.spawn(shell, args, { name: "xterm-256color", cols: 120, rows: 30, cwd, env: process.env });
  console.log(`[pty] spawned command (pid=${term.pid}) in ${cwd}: ${command}`);

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "output", data }));
  });
  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] command exited code=${exitCode} signal=${signal}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    }
  });
  return term;
}

// Resolve a launcher by its position in the user's configured list — the browser
// sends only an INDEX (the config is the allowlist), never a raw command.
function resolveLauncher(index: number): { label: string; command: string } | null {
  const list = getLaunchers();
  return Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
}

// Spawn a configured launcher command as a PERSISTENT, reattachable PTY that shares
// the Claude session lifecycle (ptys map, reattach, reap grace) but has NO hooks,
// transcript, or resume. The command is run via the login shell with `exec` so it
// becomes the single foreground process ($SHELL, codex, etc.) — env vars in the
// command (e.g. $SHELL) expand, and the process stays interactive in the PTY.
function spawnLauncherPty(sessionId: string, ws: WebSocket, command: string, cwd: string): PtyEntry {
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  const args = isWindows ? ["-NoLogo", "-Command", command] : ["-lc", `exec ${command}`];
  // Persistent: reattaches a surviving tmux session (command ignored) or creates one.
  const { term, tmux } = ptySpawn(sessionId, shell, args, cwd, true);
  console.log(`[pty] spawned launcher (pid=${term.pid}${tmux ? " via tmux" : ""}) in ${cwd}: ${command}`);

  const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux };
  ptys.set(sessionId, entry);

  term.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-OUTPUT_BUFFER_LIMIT);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "output", data }));
    }
  });
  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] launcher exited code=${exitCode} signal=${signal}`);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      entry.ws.close();
    }
    reap(sessionId);
  });
  return entry;
}

// browser -> command PTY. Like handleClientFrame but for the session-less command
// terminal: only input/resize (no terminate/session machinery).
function handleCommandFrame(term: IPty, raw: RawData) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return; // not JSON — never write arbitrary payloads to the PTY
  }
  try {
    if (msg.type === "input" && typeof msg.data === "string") {
      term.write(msg.data);
    } else if (
      msg.type === "resize" &&
      Number.isInteger(msg.cols) &&
      Number.isInteger(msg.rows) &&
      msg.cols >= 2 &&
      msg.cols <= 500 &&
      msg.rows >= 1 &&
      msg.rows <= 200
    ) {
      term.resize(msg.cols, msg.rows);
    }
  } catch (err) {
    console.warn(`[ws/run] dropped message: ${messageOf(err)}`);
  }
}

// Socket closed: detach it and decide the PTY's fate by activity — working stays
// alive, needs-the-user gets a long grace, idle gets the short grace.
function handleClientClose(entry: PtyEntry, ws: WebSocket, sessionId: string) {
  // Ignore if a newer client already reattached to this session.
  if (entry.ws !== ws) return;
  entry.ws = null;
  // Keep a working session alive indefinitely, give a session that needs the user
  // the long grace, and reap a genuinely idle one after the short grace. A reload
  // reconnects in a moment and re-attaches (cancelling the reap) regardless.
  console.log(`[ws] disconnected ${sessionId}`);
  armReapForDetached(sessionId);
}

// Pick the effective session id for a /ws connection: reattach a same-process live pty,
// else a tmux session that outlived a restart (warm, no --resume), else `--resume` an
// on-disk transcript (cold), else a fresh id. `resume` is set only for the cold case.
function resolveClaudeSession(requested: string | null, cwd: string): { reattachId: string | null; resume: string | null; sessionId: string } {
  const reattachId = requested && ptys.has(requested) ? requested : null;
  const tmuxAlive = !reattachId && !!requested && tmuxHasSession(requested);
  const resume = !reattachId && !tmuxAlive && requested && sessionExistsOnDisk(requested, cwd) ? requested : null;
  const sessionId = reattachId ?? (requested && (tmuxAlive || resume) ? requested : randomUUID());
  return { reattachId, resume, sessionId };
}

wss.on("connection", (ws, req) => {
  // ?session=<id> resumes an existing conversation; absent => fresh session. For
  // new sessions we generate the id ourselves (--session-id) so the server always
  // knows the current session's id, even before any file exists.
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  // A non-UUID id is never used (it could smuggle path/flag fragments into
  // sessionExistsOnDisk / --resume). Treat it as "no session requested" rather
  // than closing the socket — closing without a replacement id makes the client
  // auto-reconnect with the same bad id forever. Falling through mints a fresh
  // session and tells the browser the new id, so the cell self-recovers.
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  if (raw && !requested) console.warn(`[ws] ignoring non-UUID session id: ${JSON.stringify(raw)} — starting fresh`);

  // The cell may launch a terminal in a chosen directory (?cwd=<abs>). Validated
  // (absolute, existing dir) and used as the PTY cwd + the project to resume from;
  // falls back to CLAUDE_CWD.
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));

  // ?gui=0 (the grid's dev terminals) spawns claude WITHOUT the GUI plugin MCP /
  // --strict-mcp-config, so the user's + project's MCP servers load normally. Absent
  // (the single view) keeps main's behavior: GUI MCP attached + strict.
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  // Decide the effective session id BEFORE telling the browser. A requested id
  // is honored only if it can actually be served: a live pty (reattach) or an
  // on-disk transcript (`--resume`). A requested id that's neither — e.g. a cell
  // reloading an idle session claude never persisted — can't be reused: claude
  // exits with "session id already in use" if we retry `--session-id <same>`.
  // So mint a fresh id; the browser adopts it from this `session` message and
  // re-persists, so the reload just reopens a working terminal seamlessly.
  const { reattachId, resume, sessionId } = resolveClaudeSession(requested, cwd);
  const live = reattachId ? ptys.get(reattachId) : undefined;

  // A dev terminal (gui=0) is a multi-terminal GRID cell: remember its session id so
  // it's excluded from the chat sidebar (see devTerminalSessions). This is the single
  // choke point for every grid attach — new, resumed, or reattached — so the mark is
  // recorded (and re-recorded after a reboot when the cell reconnects) exactly once.
  if (!attachGuiMcp) markDevTerminalSession(sessionId);

  // Tell the browser which session this is (it learns the id of new sessions) and
  // the EFFECTIVE cwd — where claude really runs. On reattach that's the live
  // PTY's own cwd (NOT this request's ?cwd=, which it ignores); otherwise it's the
  // resolved cwd the new PTY will spawn in.
  const reportedCwd = live?.cwd ?? cwd;
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: reportedCwd }));

  let entry: PtyEntry;
  try {
    // A sandbox session's credential is snapshotted at spawn onto its read-only mount. On
    // reconnect, re-sync it from the Keychain (overwrites the mounted per-session file in
    // place) so a token that rotated since spawn doesn't leave the reattached session stuck
    // at "Not logged in".
    if (live?.sandbox) writeSandboxCredentials(sessionId);
    entry = live ? reattachPty(live, ws, sessionId) : spawnClaudePty(sessionId, resume, ws, undefined, cwd, attachGuiMcp);
  } catch (err) {
    // A failed spawn (claude missing, or node-pty's spawn-helper not executable)
    // must close just this connection — never crash the whole server.
    console.error(`[ws] failed to start session ${sessionId}: ${messageOf(err)}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: "Failed to start Claude. Is the `claude` CLI installed and on your PATH?" }));
      ws.close();
    }
    return;
  }

  // The session is now in the foreground (being viewed): clear any
  // "waiting for input" flag so it stops showing as bold.
  setWaiting(sessionId, false);

  ws.on("message", (raw) => handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => handleClientClose(entry, ws, sessionId));
});

// Command terminal: resolve the command SERVER-SIDE (the browser never sends a raw command) and run it
// in an ephemeral PTY. `?index=<n>&cwd=<dir>` runs <dir>/script.json[n]; `?buttonId=<id>&cwd&session&
// agent&model` runs a header run:"shell" button, re-resolved from config against the session context with
// shell-escaped ${vars}. When the socket closes, the process is killed.
runWss.on("connection", (ws, req) => {
  void startRunTerminal(ws, new URL(req.url ?? "/", "http://localhost"));
});

// POSIX/PowerShell single-arg quoting, so a substituted ${branch}/${repo}/${task} can't break out of the
// command string. POSIX closes the quote, escapes the literal quote, reopens; PowerShell doubles quotes.
function shellQuoteFor(platform: NodeJS.Platform): (value: string) => string {
  if (platform === "win32") return (value) => `'${value.replace(/'/g, "''")}'`;
  return (value) => `'${value.replace(/'/g, "'\\''")}'`;
}

async function resolveButtonRun(url: URL, cwd: string): Promise<{ command: string; cwd: string } | null> {
  const buttonId = url.searchParams.get("buttonId");
  if (!buttonId) return null;
  const sessionRaw = url.searchParams.get("session");
  const session = sessionRaw && SESSION_ID_RE.test(sessionRaw) ? sessionRaw : null;
  const agent = url.searchParams.get("agent") === "codex" ? "codex" : "claude";
  const config = loadHeaderConfig(cwd, getHeaderConfig());
  const context = await buildHeaderContext(cwd, { session, agent, model: url.searchParams.get("model") });
  const command = resolveButtonCommand(config, context, buttonId, shellQuoteFor(process.platform));
  return command ? { command, cwd } : null;
}

async function resolveRunTarget(url: URL): Promise<{ command: string; cwd: string } | null> {
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));
  const byButton = await resolveButtonRun(url, cwd);
  if (byButton) return byButton;
  const indexRaw = url.searchParams.get("index");
  const index = indexRaw !== null && /^\d+$/.test(indexRaw) ? Number(indexRaw) : NaN;
  return resolveScript(cwd, index);
}

async function startRunTerminal(ws: WebSocket, url: URL): Promise<void> {
  const resolved = await resolveRunTarget(url);
  if (!resolved) return closeWithError(ws, "Command not found — check your config / script.json.");
  let term: IPty;
  try {
    term = spawnCommandPty(resolved.command, resolved.cwd, ws);
  } catch (err) {
    console.error(`[ws/run] failed to start command: ${messageOf(err)}`);
    return closeWithError(ws, "Failed to start the command.");
  }
  ws.on("message", (raw) => handleCommandFrame(term, raw));
  ws.on("close", () => {
    try {
      term.kill(); // ephemeral: no reattach/grace window — the viewer is gone, so end the process
    } catch {
      // already exited — nothing to kill
    }
  });
}

// Send a terminal error to the socket and close it (no reconnect on the client side).
function closeWithError(ws: WebSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
  }
}

// The command a launcher runs when spawned fresh. On a tmux reattach it's ignored
// (tmux new-session -A attaches the running program), so a surviving session with no
// resolvable launcher index still reattaches via this harmless fallback.
const DEFAULT_LAUNCH_CMD = process.env.SHELL || "/bin/sh";

// Reattach a same-process live PTY, else spawn a launcher (which itself reattaches a
// surviving tmux session or creates one). `command` is the resolved launcher command,
// or the fallback for a tmux reattach with no launcher index.
function startLaunchEntry(sessionId: string, ws: WebSocket, live: PtyEntry | undefined, command: string, cwd: string): PtyEntry {
  if (live) return reattachPty(live, ws, sessionId);
  return spawnLauncherPty(sessionId, ws, command, cwd);
}

// Resolve a launcher ws request to a session: reattach a live pty / surviving tmux
// session (id kept, running program picked up via `tmux new-session -A`, command ignored),
// or a fresh spawn of the indexed launcher command. Returns null when there's nothing to
// reattach AND the index isn't a configured launcher.
function resolveLaunchSession(requested: string | null, index: number): { sessionId: string; live: PtyEntry | undefined; command: string } | null {
  const reattachId = requested && ptys.has(requested) ? requested : null;
  const live = reattachId ? ptys.get(reattachId) : undefined;
  const tmuxAlive = !live && !!requested && tmuxHasSession(requested);
  // A live PTY / surviving tmux session reattaches regardless of the index; only a fresh
  // spawn needs the launcher resolved (the pty already IS the chosen program on reattach).
  const launcher = live || tmuxAlive ? null : resolveLauncher(index);
  if (!live && !tmuxAlive && !launcher) return null;
  const sessionId = reattachId ?? (tmuxAlive && requested ? requested : randomUUID());
  return { sessionId, live, command: launcher?.command ?? DEFAULT_LAUNCH_CMD };
}

// Launcher terminal (?launcher=<index>&cwd=<dir>, ?session=<id> to reattach): run a
// configured launch command as a persistent, reattachable PTY. Reuses the /ws session
// lifecycle (reattach + reap grace + handleClientClose) but with no hooks/transcript,
// and is marked a dev-terminal session so it stays out of the chat sidebar.
runLaunchWss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));
  const indexRaw = url.searchParams.get("launcher");
  const index = indexRaw !== null && /^\d+$/.test(indexRaw) ? Number(indexRaw) : NaN;

  const resolved = resolveLaunchSession(requested, index);
  if (!resolved) return closeWithError(ws, "Launcher not found — check Settings → Launch commands.");
  const { sessionId, live, command } = resolved;
  markDevTerminalSession(sessionId);
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: live?.cwd ?? cwd }));

  let entry: PtyEntry;
  try {
    entry = startLaunchEntry(sessionId, ws, live, command, cwd);
  } catch (err) {
    console.error(`[ws/launch] failed to start ${sessionId}: ${messageOf(err)}`);
    return closeWithError(ws, "Failed to start the launch command.");
  }

  ws.on("message", (raw) => handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => handleClientClose(entry, ws, sessionId));
});

// codex is a first-class agent like claude, but it mints its own session id (no --session-id),
// so the browser-facing id is a mulmoterminal-minted key; we discover codex's real rollout id
// after spawn and resume it with `codex resume <id>` once the live PTY is gone. Reattach a live
// pty / surviving tmux session (running codex picked up, no resume); else cold-resume a known
// rollout id; else a fresh session (a new minted key).
// A rollout id to cold-resume for a requested session key: one we started here (key -> rollout id),
// or a rollout id straight from the sidebar (its own id), or null (start fresh).
function codexResumeIdFor(requested: string): string | null {
  const mapped = codexRolloutIds.get(requested);
  if (mapped) return mapped;
  return codexRolloutExists(codexSessionsRoot(), requested) ? requested : null;
}

function resolveCodexSession(requested: string | null): { sessionId: string; live: PtyEntry | undefined; resumeRolloutId: string | null } {
  const reattachId = requested && ptys.has(requested) ? requested : null;
  const live = reattachId ? ptys.get(reattachId) : undefined;
  const tmuxAlive = !live && !!requested && tmuxHasSession(requested);
  const resumeRolloutId = !live && !tmuxAlive && requested ? codexResumeIdFor(requested) : null;
  const sessionId = reattachId ?? ((tmuxAlive || resumeRolloutId) && requested ? requested : randomUUID());
  return { sessionId, live, resumeRolloutId };
}

function wireCodexRelay(entry: PtyEntry, sessionId: string, onOutput?: (data: string) => void): void {
  entry.term.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-OUTPUT_BUFFER_LIMIT);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) entry.ws.send(JSON.stringify({ type: "output", data }));
    onOutput?.(data);
  });
  entry.term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] codex exited code=${exitCode} signal=${signal}`);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      entry.ws.close();
    }
    reap(sessionId);
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
  const args = buildCodexArgs({ resume: resumeRolloutId, model: CODEX_MODEL, guiMcpUrl });
  const { term, tmux } = ptySpawn(sessionId, CODEX_BIN, args, cwd, true);
  const via = tmux ? " via tmux" : "";
  const resumeNote = resumeRolloutId ? ` (resume ${resumeRolloutId})` : "";
  console.log(`[pty] spawned codex (pid=${term.pid}${via}) in ${cwd}${resumeNote}`);
  const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux };
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

function startCodexEntry(
  sessionId: string,
  ws: WebSocket,
  live: PtyEntry | undefined,
  resumeRolloutId: string | null,
  cwd: string,
  attachGuiMcp: boolean,
): PtyEntry {
  if (live) return reattachPty(live, ws, sessionId);
  return spawnCodexPty(sessionId, ws, resumeRolloutId, cwd, attachGuiMcp, null); // interactive: no seed
}

// codex terminal (?cwd=<dir>, ?session=<id> to reattach/resume). ?gui=0 (grid dev terminal) runs
// codex without the GUI MCP and keeps it out of the sidebar; absent (single view) attaches the GUI
// MCP so codex drives the GUI panel like claude.
runCodexWss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  const { sessionId, live, resumeRolloutId } = resolveCodexSession(requested);
  if (!attachGuiMcp) markDevTerminalSession(sessionId);
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: live?.cwd ?? cwd }));

  let entry: PtyEntry;
  try {
    entry = startCodexEntry(sessionId, ws, live, resumeRolloutId, cwd, attachGuiMcp);
  } catch (err) {
    console.error(`[ws/codex] failed to start ${sessionId}: ${messageOf(err)}`);
    return closeWithError(ws, "Failed to start codex. Is the `codex` CLI installed and on your PATH?");
  }

  ws.on("message", (raw) => handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => handleClientClose(entry, ws, sessionId));
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
