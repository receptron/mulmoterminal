import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createPubSub } from "./pubsub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3456;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.env.HOME;

// A session id is always a UUID (server-generated, or a .jsonl basename). Reject
// anything else so a client can't smuggle CLI flags (e.g. "--resume" followed by
// a value that claude re-parses as a flag) into the spawned process.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only same-machine browser origins may open the terminal / pub-sub sockets, so
// a malicious website the user visits can't drive the local Claude PTY (a
// cross-site WebSocket hijack). A missing Origin (non-browser local client) is
// allowed; any localhost host on any port is allowed (covers the Vite dev proxy).
function isAllowedOrigin(origin) {
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

// Pub/sub channel the GUI panel subscribes to. The presentMarkdown MCP tool
// POSTs to /api/gui, which stores the payload and publishes it here keyed by
// session id (see docs/gui-protocol-spike.md).
const GUI_CHANNEL = "gui";

// Stdio MCP server wired into each spawned claude (--mcp-config). It exposes the
// presentMarkdown tool that drives the GUI panel.
const MCP_SERVER_PATH = path.join(__dirname, "mcp", "present-markdown.js");

// MCP tool name claude uses, in the mcp__<server>__<tool> form. Auto-allowed via
// --allowedTools so the spike doesn't trip the permission prompt (a deferred
// probe — see the doc).
const GUI_MCP_TOOL = "mcp__mulmoterminal-gui__presentMarkdown";

// Latest GUI payloads per session, kept in memory for the spike so the panel can
// replay them when a session is (re)selected. Each entry is an array, capped to
// the most recent N frames.
const guiPayloads = new Map(); // id -> [{ type, data }]
const GUI_HISTORY_LIMIT = 50;

// Only the most-recent N sessions are listed in the sidebar; older ones aren't
// read or parsed, keeping /api/sessions cheap for projects with many sessions.
const SESSION_LIST_LIMIT = 50;

// Per-session "working" state, driven by Claude hooks (see /api/hook):
// UserPromptSubmit => Claude started thinking; Stop => it finished.
const activity = new Map(); // id -> { working, event, at }

// Live ptys keyed by session id. A pty outlives its WebSocket while the session
// is still "working", so switching away doesn't interrupt Claude mid-turn; it
// is reaped once the session goes idle (Stop hook) or the process exits. `ws`
// is null while the session runs in the background.
const ptys = new Map(); // id -> { term, ws, buffer }

// New sessions started in this process that have no .jsonl on disk yet (Claude
// only writes the file on the first prompt). Merged into /api/sessions so a
// freshly created session shows in the sidebar immediately. An entry is dropped
// once the file exists (the on-disk record takes over) or the pty is reaped.
const knownSessions = new Map(); // id -> { createdAt, title }

// Bytes of recent output kept per pty and replayed when a client reattaches to
// a background session, so the user sees context instead of a blank screen.
const OUTPUT_BUFFER_LIMIT = 64 * 1024;

// Assigned once the HTTP server exists (createPubSub needs it).
let pubsub = null;

// Tear down a session's PTY and bookkeeping, then notify subscribers. The
// `activity` entry is dropped too — UNLESS it still carries `waiting`, which is
// what keeps a finished/needs-attention background session bold (via its
// on-disk record) until the user opens it. This keeps `activity` from growing
// unbounded while preserving the bold-until-viewed behavior.
function reap(id) {
  const entry = ptys.get(id);
  if (!entry) return; // already reaped
  ptys.delete(id);
  // An unpersisted new session vanishes with its pty; a persisted one stays
  // visible via its on-disk record.
  knownSessions.delete(id);
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
function publishActivity(id) {
  const a = activity.get(id) || {};
  pubsub?.publish(SESSIONS_CHANNEL, {
    id,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    event: a.event ?? null,
  });
}

// Claude is thinking (UserPromptSubmit) until it finishes (Stop). No-op (and no
// publish) when the state is unchanged.
function setWorking(id, working, event) {
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
function setWaiting(id, waiting, event) {
  const prev = activity.get(id) || {};
  if ((prev.waiting ?? false) === waiting) return;
  activity.set(id, { ...prev, waiting, event: event ?? prev.event ?? null, at: Date.now() });
  publishActivity(id);
}

// Hook config injected via `claude --settings <json>`. Each event POSTs the
// hook payload (session_id + hook_event_name) to /api/hook:
//   UserPromptSubmit => working, Stop => idle,
//   Notification     => waiting for input (permission / question / idle).
function hookSettingsJson() {
  const cmd =
    `curl -s -X POST http://localhost:${PORT}/api/hook ` +
    `-H 'content-type: application/json' -d @- >/dev/null 2>&1`;
  const entry = [{ hooks: [{ type: "command", command: cmd }] }];
  return JSON.stringify({
    hooks: { UserPromptSubmit: entry, Stop: entry, Notification: entry },
  });
}

// MCP config injected via `claude --mcp-config <json>`. Registers the stdio
// presentMarkdown server and passes this session's id + the server port to it
// via env (the MCP process can't otherwise know which session it belongs to).
function mcpConfigJson(sessionId) {
  return JSON.stringify({
    mcpServers: {
      "mulmoterminal-gui": {
        command: process.execPath, // the node running this server
        args: [MCP_SERVER_PATH],
        env: {
          MULMOTERMINAL_SESSION_ID: sessionId,
          MULMOTERMINAL_PORT: String(PORT),
        },
      },
    },
  });
}

// Claude stores each project's sessions under ~/.claude/projects/<encoded-cwd>/,
// where the absolute cwd has its "/" and "." characters replaced by "-".
function projectSessionsDir(cwd) {
  const encoded = path.resolve(cwd).replace(/[/.]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

// Scan a session JSONL for a human-friendly title and last activity.
async function readSessionMeta(dir, file) {
  const full = path.join(dir, file);
  const [raw, stat] = await Promise.all([
    fs.readFile(full, "utf8"),
    fs.stat(full),
  ]);

  let aiTitle = null;
  let lastPrompt = null;
  let firstUserMsg = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === "ai-title" && o.aiTitle) aiTitle = o.aiTitle;
    else if (o.type === "last-prompt" && o.lastPrompt) lastPrompt = o.lastPrompt;
    else if (o.type === "user" && firstUserMsg === null) {
      let c = o.message?.content;
      if (Array.isArray(c)) {
        // Guard against null elements (`typeof null === "object"`).
        c = c.map((x) => (x && typeof x === "object" ? x.text || "" : x)).join(" ");
      }
      // Skip slash-command / local-command wrappers that aren't real prompts.
      if (typeof c === "string" && c.trim() && !/^\s*<(local-command|command-|bash-)/.test(c)) {
        firstUserMsg = c.trim();
      }
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
app.use(express.json());

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

// Claude hooks (Stop / Notification) POST their payload here so we can flag
// which background sessions have new activity.
app.post("/api/hook", (req, res) => {
  const { session_id, hook_event_name } = req.body || {};
  if (session_id) {
    const entry = ptys.get(session_id);
    const foreground = entry && entry.ws; // a ws is attached => being viewed
    if (hook_event_name === "UserPromptSubmit") {
      setWorking(session_id, true, hook_event_name);
    } else if (hook_event_name === "Stop") {
      // A background session that finished a turn has output the user hasn't
      // seen yet (and is ready for another message) — flag it for attention.
      if (!foreground) setWaiting(session_id, true, hook_event_name);
      setWorking(session_id, false, hook_event_name);
    } else if (hook_event_name === "Notification") {
      // Background session waiting for input (permission / question / idle).
      if (!foreground) setWaiting(session_id, true, hook_event_name);
    }
    console.log(`[hook] ${hook_event_name} for ${session_id}`);
  }
  res.json({ ok: true });
});

// The presentMarkdown MCP tool POSTs GUI frames here. We validate the frame,
// store the latest payloads keyed by session id (in-memory for the spike), and
// publish on the "gui" channel so the active GUI panel renders it live.
app.post("/api/gui", (req, res) => {
  const { sessionId, type, data } = req.body || {};
  // The MCP process is local and trusted, but the session id flows from env and
  // ends up in a pub/sub channel filter — keep it to the known UUID shape.
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  if (typeof type !== "string" || type !== "presentMarkdown") {
    return res.status(400).json({ error: "unsupported type" });
  }
  if (!data || typeof data !== "object" || typeof data.markdown !== "string") {
    return res.status(400).json({ error: "invalid data" });
  }

  const frame = { type, data: { markdown: data.markdown } };
  const list = guiPayloads.get(sessionId) || [];
  list.push(frame);
  if (list.length > GUI_HISTORY_LIMIT) list.splice(0, list.length - GUI_HISTORY_LIMIT);
  guiPayloads.set(sessionId, list);

  pubsub?.publish(GUI_CHANNEL, { sessionId, ...frame });
  console.log(`[gui] ${type} for ${sessionId}`);
  res.json({ ok: true });
});

// Replay a session's stored GUI payloads so the panel can render them when the
// user (re)selects that session.
app.get("/api/gui/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid sessionId" });
  }
  res.json({ sessionId, payloads: guiPayloads.get(sessionId) || [] });
});

// List the chat sessions for the current project (CLAUDE_CWD), including
// newly-created sessions that aren't persisted to disk yet.
app.get("/api/sessions", async (_req, res) => {
  try {
    const dir = projectSessionsDir(CLAUDE_CWD);
    let files = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    // Cheap pass: stat (don't read) every file just for its mtime, so we can
    // rank by recency. Skip any that vanished between readdir and stat.
    const onDiskStats = (
      await Promise.all(
        files.map(async (file) => {
          try {
            const st = await fs.stat(path.join(dir, file));
            return { kind: "disk", id: path.basename(file, ".jsonl"), file, mtime: st.mtimeMs };
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    const onDisk = new Set(onDiskStats.map((s) => s.id));

    // In-memory sessions not yet written to disk. Prune any that have since
    // been persisted — the on-disk record (with its real title) wins.
    const pending = [];
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
    const top = [...onDiskStats, ...pending]
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, SESSION_LIST_LIMIT);
    const sessions = (
      await Promise.all(
        top.map((s) =>
          s.kind === "pending"
            ? { id: s.id, title: s.title, mtime: s.mtime, working: s.working, waiting: s.waiting }
            : readSessionMeta(dir, s.file).catch(() => null)
        )
      )
    )
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ cwd: CLAUDE_CWD, sessions });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

const server = http.createServer(app);
pubsub = createPubSub(server, isAllowedOrigin);

// Terminal WebSocket. Uses noServer + manual upgrade routing so it shares the
// HTTP server with socket.io (the pub/sub at /ws/pubsub) without the two
// libraries fighting over the "upgrade" event.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
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

wss.on("connection", (ws, req) => {
  // ?session=<id> resumes an existing conversation; absent => fresh session.
  // For new sessions we generate the id ourselves (--session-id) so the server
  // always knows the current session's id, even before any file exists.
  const resume = new URL(req.url, "http://localhost").searchParams.get("session");
  if (resume && !SESSION_ID_RE.test(resume)) {
    console.warn(`[ws] rejecting non-UUID session id: ${JSON.stringify(resume)}`);
    ws.close();
    return;
  }
  const sessionId = resume || randomUUID();

  // Tell the browser which session this is (it learns the id of new sessions).
  ws.send(JSON.stringify({ type: "session", id: sessionId }));

  let entry = ptys.get(sessionId);
  if (entry) {
    // A background pty for this session is still alive — reattach instead of
    // spawning a duplicate claude. Replay recent output for context.
    console.log(`[ws] reattach ${sessionId} (pid=${entry.term.pid})`);
    // Drop any socket still attached (e.g. the same session open in another
    // tab) so it can't keep writing to this PTY.
    if (entry.ws && entry.ws !== ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.close();
    }
    entry.ws = ws;
    if (entry.buffer && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data: entry.buffer }));
    }
  } else {
    const settings = hookSettingsJson();
    // Register the GUI MCP server and auto-allow its tool so presentMarkdown
    // runs without a permission prompt (--strict-mcp-config keeps the user's
    // other MCP servers out of the spike).
    const mcp = mcpConfigJson(sessionId);
    const guiArgs = ["--mcp-config", mcp, "--strict-mcp-config", "--allowedTools", GUI_MCP_TOOL];
    const args = resume
      ? ["--resume", resume, "--settings", settings, ...guiArgs]
      : ["--session-id", sessionId, "--settings", settings, ...guiArgs];

    console.log(`[ws] client connected (${resume ? "resume" : "new"} ${sessionId})`);

    const term = pty.spawn(CLAUDE_BIN, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: CLAUDE_CWD,
      env: process.env,
    });
    console.log(`[pty] spawned claude (pid=${term.pid})`);

    entry = { term, ws, buffer: "" };
    ptys.set(sessionId, entry);

    if (!resume) {
      // Brand-new session: surface it in the sidebar before it's persisted.
      knownSessions.set(sessionId, { createdAt: Date.now(), title: "New session" });
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
  }

  // The session is now in the foreground (being viewed): clear any
  // "waiting for input" flag so it stops showing as bold.
  setWaiting(sessionId, false);

  // browser -> PTY. The protocol is client-controlled, so validate every frame
  // before touching node-pty (bad cols/rows or non-string input can throw).
  ws.on("message", (raw) => {
    // Ignore frames from a socket that a newer client has already superseded.
    if (entry.ws !== ws) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // not JSON — never write arbitrary payloads to the PTY
    }
    try {
      if (msg.type === "input" && typeof msg.data === "string") {
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
      console.warn(`[ws] dropped message for ${sessionId}: ${err.message}`);
    }
  });

  ws.on("close", () => {
    // Ignore if a newer client already reattached to this session.
    if (entry.ws !== ws) return;
    entry.ws = null;

    // Keep the pty running if Claude is still working — it will be reaped when
    // the Stop hook fires (see setWorking). Otherwise kill it now.
    if (activity.get(sessionId)?.working) {
      console.log(`[ws] disconnected; keeping working session ${sessionId} alive`);
    } else {
      console.log(`[ws] disconnected; killing idle session ${sessionId}`);
      reap(sessionId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`mulmoterminal running at http://localhost:${PORT}`);
});
