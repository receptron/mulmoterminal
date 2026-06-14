import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3456;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.env.HOME;

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
        c = c.map((x) => (typeof x === "object" ? x.text || "" : x)).join(" ");
      }
      // Skip slash-command / local-command wrappers that aren't real prompts.
      if (typeof c === "string" && c.trim() && !/^\s*<(local-command|command-|bash-)/.test(c)) {
        firstUserMsg = c.trim();
      }
    }
  }

  const title = aiTitle || lastPrompt || firstUserMsg || "(untitled session)";
  return {
    id: path.basename(file, ".jsonl"),
    title,
    mtime: stat.mtimeMs,
  };
}

const app = express();

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

// List the chat sessions for the current project (CLAUDE_CWD).
app.get("/api/sessions", async (_req, res) => {
  try {
    const dir = projectSessionsDir(CLAUDE_CWD);
    let files;
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (err.code === "ENOENT") return res.json({ cwd: CLAUDE_CWD, sessions: [] });
      throw err;
    }
    const sessions = (await Promise.all(files.map((f) => readSessionMeta(dir, f))))
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ cwd: CLAUDE_CWD, sessions });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  // ?session=<id> resumes an existing conversation; absent => fresh session.
  const session = new URL(req.url, "http://localhost").searchParams.get("session");
  const args = session ? ["--resume", session] : [];

  console.log(`[ws] client connected${session ? ` (resume ${session})` : ""}`);

  const term = pty.spawn(CLAUDE_BIN, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: CLAUDE_CWD,
    env: process.env,
  });

  console.log(`[pty] spawned claude (pid=${term.pid})`);

  // PTY -> browser
  term.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] exited code=${exitCode} signal=${signal}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    }
  });

  // browser -> PTY
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input") {
        term.write(msg.data);
      } else if (msg.type === "resize") {
        term.resize(msg.cols, msg.rows);
      }
    } catch {
      term.write(raw.toString());
    }
  });

  ws.on("close", () => {
    console.log("[ws] client disconnected, killing pty");
    term.kill();
  });
});

server.listen(PORT, () => {
  console.log(`mulmoterminal running at http://localhost:${PORT}`);
});
