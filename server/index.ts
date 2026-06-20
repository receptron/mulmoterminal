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
import { loadPresets, savePresets, sanitizePresets, type CwdPreset } from "./cwd-presets.js";

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3456;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
// Permission mode for backend-spawned Claude sessions. Defaults to "auto" so
// the backend runs hands-off; override with CLAUDE_PERMISSION_MODE (e.g.
// "default" / "acceptEdits" / "bypassPermissions" / "plan") when needed.
const CLAUDE_PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "auto";
const CLAUDE_CWD = process.env.CLAUDE_CWD || path.join(os.homedir(), "mulmoclaude");

// CLAUDE_CWD is the workspace used as the PTY cwd and as the root for persisted
// session state, so it must exist before we spawn anything into it.
await fs.mkdir(CLAUDE_CWD, { recursive: true });

// MulmoTerminal's own per-session GUI state (tool-result render data + tool-call
// history) lives here, keyed by sessionId (a global UUID) — NOT under the
// workspace dir, so it stays valid regardless of which directory is active.
const MULMOTERMINAL_HOME = path.join(os.homedir(), ".mulmoterminal");

// User config (currently just directory presets the launch form offers),
// persisted at ~/.mulmoterminal/config.json. Logic lives in ./cwd-presets.
const CONFIG_FILE = path.join(MULMOTERMINAL_HOME, "config.json");
let cwdPresets: CwdPreset[] = loadPresets(CONFIG_FILE);

// A session id is always a UUID (server-generated, or a .jsonl basename). Reject
// anything else so a client can't smuggle CLI flags (e.g. "--resume" followed by
// a value that claude re-parses as a flag) into the spawned process.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// The GUI MCP server is served in-process over Streamable HTTP at /mcp/:sessionId
// (see the route below) and wired into each spawned claude via --mcp-config. It
// exposes one GUI-protocol tool per enabled plugin (driven by plugins/plugins.json)
// and drives the GUI panel via the toolResult route.

// MCP tool names claude uses, in the mcp__<server>__<tool> form, one per enabled
// plugin. Auto-allowed via --allowedTools so the spike doesn't trip the permission
// prompt (permissions stay terminal-native). Comma-joined into one --allowedTools.
const GUI_MCP_TOOLS = allowedToolNames().join(",");

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

// Latest user prompt per session (from the UserPromptSubmit hook), shown on the
// grid cell header so you can tell at a glance what each terminal is doing.
const lastPrompts = new Map<string, string>(); // id -> prompt text
const LAST_PROMPT_CAP = 200;

// Live ptys keyed by session id. A pty outlives its WebSocket while the session
// is still "working", so switching away doesn't interrupt Claude mid-turn; it
// is reaped once the session goes idle (Stop hook) or the process exits. `ws`
// is null while the session runs in the background.
const ptys = new Map<string, PtyEntry>(); // id -> { term, ws, buffer }

// New sessions started in this process that have no .jsonl on disk yet (Claude
// only writes the file on the first prompt). Merged into /api/sessions so a
// freshly created session shows in the sidebar immediately. An entry is dropped
// once the file exists (the on-disk record takes over) or the pty is reaped.
const knownSessions = new Map<string, KnownSession>(); // id -> { createdAt, title }

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
const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelReap(id: string) {
  const t = reapTimers.get(id);
  if (t) {
    clearTimeout(t);
    reapTimers.delete(id);
  }
}

function scheduleReap(id: string) {
  if (reapTimers.has(id)) return;
  reapTimers.set(
    id,
    setTimeout(() => {
      reapTimers.delete(id);
      const entry = ptys.get(id);
      if (entry && !entry.ws) reap(id); // still detached after the grace window
    }, REAP_GRACE_MS),
  );
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
  if (!a || (!a.working && !a.waiting)) activity.delete(id);
  try {
    entry.term.kill();
  } catch {
    // already gone
  }
  pubsub?.publish(SESSIONS_CHANNEL, { id, working: false, event: "closed" });
}

// Publish a session's current activity (working + waiting) to subscribers.
function publishActivity(id: string) {
  const a = activity.get(id) || {};
  pubsub?.publish(SESSIONS_CHANNEL, {
    id,
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

  // A background session (no attached client) that just went idle is reaped.
  if (!working) {
    const entry = ptys.get(id);
    if (entry && !entry.ws) {
      console.log(`[pty] reaping idle background session ${id}`);
      reap(id);
    }
  }
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
}

// Hook config injected via `claude --settings <json>`. Each event POSTs the full
// hook payload to /api/hook. UserPromptSubmit => working, Stop => idle,
// Notification => waiting for input. PreToolUse/PostToolUse/PostToolUseFailure
// (matcher "" => every tool, including built-ins and MCP tools) feed the
// per-session tool-call history that the GUI's tools pane shows. A failed tool
// fires PostToolUseFailure (NOT PostToolUse), so we register both to complete the
// entry either way — otherwise a failed call would stay stuck on "running".
function hookSettingsJson() {
  const cmd = `curl -s -X POST http://localhost:${PORT}/api/hook ` + `-H 'content-type: application/json' -d @- >/dev/null 2>&1`;
  const entry = [{ hooks: [{ type: "command", command: cmd }] }];
  // Tool hooks take a matcher; "" matches all tools.
  const toolEntry = [{ matcher: "", hooks: [{ type: "command", command: cmd }] }];
  return JSON.stringify({
    hooks: {
      UserPromptSubmit: entry,
      Stop: entry,
      Notification: entry,
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
function mcpConfigJson(sessionId: string) {
  return JSON.stringify({
    mcpServers: {
      "mulmoterminal-gui": {
        type: "http",
        url: `http://127.0.0.1:${PORT}/mcp/${sessionId}`,
      },
    },
  });
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

// A real user prompt from a JSONL "user" line's content, or null if it's a
// slash-/local-command wrapper rather than a typed prompt. Content may be a
// plain string or an array of blocks (guard against null elements).
function userPromptText(content: unknown): string | null {
  const text = Array.isArray(content) ? content.map((x) => (isRecord(x) ? String(x.text ?? "") : String(x ?? ""))).join(" ") : content;
  if (typeof text === "string" && text.trim() && !/^\s*<(local-command|command-|bash-)/.test(text)) {
    return text.trim();
  }
  return null;
}

// Parse a JSONL file into the objects on each non-blank, valid line.
function parseJsonl(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o: unknown = JSON.parse(line);
      if (isRecord(o)) out.push(o);
    } catch {
      // Skip malformed lines.
    }
  }
  return out;
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
// `role`/`hidden` are accepted for signature parity with MulmoClaude but ignored:
// the session is always visible. Registered BEFORE mountAllRoutes so this specific
// route wins over /api/plugin/:toolName.
app.post("/api/plugin/spawnBackgroundChat", (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return res.json({ message: "spawnBackgroundChat: `message` is required (non-empty string)." });
  }
  const sessionId = randomUUID();
  // ws is null: the session runs headless until the user opens it (reattach
  // replays the buffered output). The "created" pubsub event in spawnClaudePty
  // surfaces it in the sidebar right away.
  try {
    spawnClaudePty(sessionId, null, null, message);
  } catch (err) {
    console.error(`[spawnBackgroundChat] failed for ${sessionId}: ${messageOf(err)}`);
    return res.json({ message: `Failed to spawn a new session: ${messageOf(err)}` });
  }
  return res.json({
    message: `Spawned a new terminal session (chatId ${sessionId}). It runs in parallel; the user can open it from the sidebar.`,
    jsonData: { chatId: sessionId },
  });
});

// Mount each enabled GUI plugin's REST routes (e.g. POST /api/markdown,
// POST /api/form). The GUI MCP server dispatches tool calls to these.
mountAllRoutes(app);

// In-process GUI MCP server, served over Streamable HTTP. claude (wired up via
// mcpConfigJson) POSTs JSON-RPC here; the session id is in the URL path. We run in
// STATELESS mode (sessionIdGenerator: undefined): one fresh Server+transport per
// request, no session header / no initialize handshake required across requests.
// The SDK forbids reusing a stateless transport, so we never cache it.
const mcpReject = (_req: express.Request, res: express.Response) => res.status(405).set("Allow", "POST").json({ error: "method not allowed" });
app.post("/mcp/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  const server = buildGuiMcpServer(sessionId, `http://127.0.0.1:${PORT}`);
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
app.get("/mcp/:sessionId", mcpReject);
app.delete("/mcp/:sessionId", mcpReject);

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

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

// Claude hooks (Stop / Notification / Pre|PostToolUse) POST their payload here so
// we can flag which background sessions have new activity / build tool history.
app.post("/api/hook", async (req, res) => {
  const body = req.body || {};
  const sessionId = body.session_id;
  const event = body.hook_event_name;
  if (sessionId) {
    const entry = ptys.get(sessionId);
    const foreground = !!(entry && entry.ws);
    // Capture the prompt BEFORE handleActivityHook so the activity publish it
    // triggers already carries the new lastPrompt.
    if (event === "UserPromptSubmit" && typeof body.prompt === "string" && body.prompt.trim()) {
      lastPrompts.set(sessionId, body.prompt.trim().slice(0, LAST_PROMPT_CAP));
    }
    handleActivityHook(sessionId, event, foreground);
    await handleToolHook(sessionId, event, body);
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

// Server-wide config the UI shows: the default workspace dir + the user's saved
// directory presets (offered in the cell launch form).
app.get("/api/config", (_req, res) => {
  res.json({ cwd: CLAUDE_CWD, cwdPresets });
});

// Update the directory presets (from the settings screen) and persist them.
app.post("/api/config", (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.cwdPresets)) return res.status(400).json({ error: "cwdPresets must be an array" });
  // Stage, persist, then commit in-memory only on success — a failed write must
  // not leave GET exposing presets that won't survive a restart.
  const next = sanitizePresets(body.cwdPresets);
  if (!savePresets(CONFIG_FILE, next)) return res.status(500).json({ error: "failed to persist presets" });
  cwdPresets = next;
  res.json({ cwd: CLAUDE_CWD, cwdPresets });
});

// Initial per-session status + last prompt, so a cell can render its header
// immediately (the live updates then arrive via the "sessions" pub/sub channel).
app.get("/api/session/:id", (req, res) => {
  const { id } = req.params;
  if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
  const a = activity.get(id) || {};
  res.json({
    id,
    cwd: CLAUDE_CWD,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    lastPrompt: lastPrompts.get(id) ?? null,
  });
});

// List the chat sessions for the current project (CLAUDE_CWD), including
// newly-created sessions that aren't persisted to disk yet.
app.get("/api/sessions", async (_req, res) => {
  try {
    const dir = projectSessionsDir(CLAUDE_CWD);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (!hasErrnoCode(err) || err.code !== "ENOENT") throw err;
    }

    // Cheap pass: stat (don't read) every file just for its mtime, so we can
    // rank by recency. Skip any that vanished between readdir and stat.
    const onDiskStats = (
      await Promise.all(
        files.map(async (file): Promise<DiskStat | null> => {
          try {
            const st = await fs.stat(path.join(dir, file));
            return { kind: "disk", id: path.basename(file, ".jsonl"), file, mtime: st.mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    ).filter((s): s is DiskStat => s !== null);
    const onDisk = new Set(onDiskStats.map((s) => s.id));

    // In-memory sessions not yet written to disk. Prune any that have since
    // been persisted — the on-disk record (with its real title) wins.
    const pending: PendingSession[] = [];
    for (const [id, meta] of knownSessions) {
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
      });
    }

    // Keep only the most-recent N, then read & parse contents for just those
    // on-disk files (a deleted/corrupt file is dropped, not fatal).
    const top = [...onDiskStats, ...pending].sort((a, b) => b.mtime - a.mtime).slice(0, SESSION_LIST_LIMIT);
    const sessions = (
      await Promise.all(
        top.map((s) =>
          s.kind === "pending"
            ? { id: s.id, title: s.title, mtime: s.mtime, working: s.working, waiting: s.waiting }
            : readSessionMeta(dir, s.file).catch(() => null),
        ),
      )
    )
      .filter((s): s is SessionMeta => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ cwd: CLAUDE_CWD, sessions });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

const server = http.createServer(app);
pubsub = createPubSub(server, isAllowedOrigin);

// Give the markdown host app its workspace (for artifacts/documents storage) +
// pubsub (to forward file-change events to the plugin-scoped channel so the
// presentDocument view live-refreshes). Done after pubsub exists (task #6).
initMarkdownBackend({ workspace: CLAUDE_CWD, pubsub });

// Give the artifacts FileOps backend its workspace root (<workspace>/artifacts) so
// @mulmoclaude/chart-plugin's executeChart can persist chart documents there.
initArtifactsBackend({ workspace: CLAUDE_CWD });

// Terminal WebSocket. Uses noServer + manual upgrade routing so it shares the
// HTTP server with socket.io (the pub/sub at /ws/pubsub) without the two
// libraries fighting over the "upgrade" event.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/ws") {
    if (!isAllowedOrigin(req.headers.origin)) {
      console.warn(`[ws] rejected cross-origin upgrade from ${req.headers.origin}`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  }
  // Other paths (e.g. /ws/pubsub) are left to socket.io's own upgrade handler.
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
    ws.send(JSON.stringify({ type: "output", data: entry.buffer }));
  }
  return entry;
}

// Spawn a fresh claude PTY for this session, register it, and wire its output /
// exit back to the browser socket. `ws` may be null for a session spawned without
// a viewer yet (e.g. spawnBackgroundChat) — output just buffers until a client
// reattaches. `initialPrompt`, when given, is passed to claude as the first turn
// so the session starts working immediately, before anyone opens it.
function spawnClaudePty(sessionId: string, resume: string | null, ws: WebSocket | null, initialPrompt?: string, cwd: string = CLAUDE_CWD): PtyEntry {
  const settings = hookSettingsJson();
  // Register the GUI MCP server and auto-allow its tools so the plugin tools run
  // without a permission prompt. We deliberately do NOT pass --strict-mcp-config:
  // --mcp-config is additive, so the user's (~/.claude.json) and the project's
  // (<cwd>/.mcp.json) MCP servers load alongside the GUI MCP — MulmoTerminal is a
  // real Claude Code dev terminal, not just the GUI layer. (skills are already
  // honored: claude reads ~/.claude/skills + <cwd>/.claude/skills by cwd.)
  const mcp = mcpConfigJson(sessionId);
  const guiArgs = ["--permission-mode", CLAUDE_PERMISSION_MODE, "--mcp-config", mcp, "--allowedTools", GUI_MCP_TOOLS];
  // Only `--resume` when the session actually exists on disk. claude doesn't write
  // a session's .jsonl until its first prompt, so a started-but-unused session has
  // no record — resuming it would fail ("[session ended]"). In that case (no live
  // pty either, since reattach already happened upstream) restart fresh, reusing
  // the same id via --session-id, so a reload of an idle cell just reopens it.
  const canResume = resume !== null && sessionExistsOnDisk(resume, cwd);
  const baseArgs = canResume ? ["--resume", resume, "--settings", settings, ...guiArgs] : ["--session-id", sessionId, "--settings", settings, ...guiArgs];
  // The initial prompt goes last as a positional arg (claude's initial-prompt
  // form). "--" ends option parsing so a prompt that happens to start with "-"
  // can't be reinterpreted as a flag.
  const args = initialPrompt ? [...baseArgs, "--", initialPrompt] : baseArgs;

  console.log(`[ws] client connected (${canResume ? "resume" : "new"} ${sessionId})`);

  const term = pty.spawn(CLAUDE_BIN, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: process.env,
  });
  console.log(`[pty] spawned claude (pid=${term.pid}) in ${cwd}`);

  const entry: PtyEntry = { term, ws, buffer: "", cwd };
  ptys.set(sessionId, entry);

  if (!canResume) {
    // Brand-new (or restarted-idle) session: surface it in the sidebar before
    // it's persisted. A spawned session (initialPrompt) gets a title from its
    // first message so it's recognizable in the sidebar before anyone opens it.
    const title = initialPrompt ? initialPrompt.replace(/\s+/g, " ").trim().slice(0, 60) || "New session" : "New session";
    knownSessions.set(sessionId, { createdAt: Date.now(), title });
    pubsub?.publish(SESSIONS_CHANNEL, { id: sessionId, working: false, event: "created" });
  }

  // PTY -> browser (buffering a bounded tail for reattach).
  term.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-OUTPUT_BUFFER_LIMIT);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  term.onExit(({ exitCode, signal }) => {
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

// Socket closed: detach it; keep the PTY alive if Claude is mid-turn (reaped on
// the Stop hook), otherwise reap now.
function handleClientClose(entry: PtyEntry, ws: WebSocket, sessionId: string) {
  // Ignore if a newer client already reattached to this session.
  if (entry.ws !== ws) return;
  entry.ws = null;
  if (activity.get(sessionId)?.working) {
    console.log(`[ws] disconnected; keeping working session ${sessionId} alive`);
  } else {
    // Don't reap now — a reload reconnects in a moment and should re-attach to
    // this same live terminal. Reap only if nothing reattaches within the window.
    console.log(`[ws] disconnected; idle session ${sessionId} reaped in ${REAP_GRACE_MS / 1000}s unless reattached`);
    scheduleReap(sessionId);
  }
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

  // Decide the effective session id BEFORE telling the browser. A requested id
  // is honored only if it can actually be served: a live pty (reattach) or an
  // on-disk transcript (`--resume`). A requested id that's neither — e.g. a cell
  // reloading an idle session claude never persisted — can't be reused: claude
  // exits with "session id already in use" if we retry `--session-id <same>`.
  // So mint a fresh id; the browser adopts it from this `session` message and
  // re-persists, so the reload just reopens a working terminal seamlessly.
  const reattachId = requested && ptys.has(requested) ? requested : null;
  const resume = !reattachId && requested && sessionExistsOnDisk(requested, cwd) ? requested : null;
  const sessionId = reattachId ?? resume ?? randomUUID();
  const live = reattachId ? ptys.get(reattachId) : undefined;

  // Tell the browser which session this is (it learns the id of new sessions) and
  // the EFFECTIVE cwd — where claude really runs. On reattach that's the live
  // PTY's own cwd (NOT this request's ?cwd=, which it ignores); otherwise it's the
  // resolved cwd the new PTY will spawn in.
  const reportedCwd = live?.cwd ?? cwd;
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: reportedCwd }));

  let entry: PtyEntry;
  try {
    entry = live ? reattachPty(live, ws, sessionId) : spawnClaudePty(sessionId, resume, ws, undefined, cwd);
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
});
