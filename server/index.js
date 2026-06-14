import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3456;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.env.HOME;

const app = express();

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("[ws] client connected");

  const term = pty.spawn(CLAUDE_BIN, [], {
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
