// CI regression check for the terminal (PTY) path: connect to the running
// launcher's /ws and assert it actually spawns a PTY — a `session` frame
// followed by `output`/`exit` — rather than an `error` frame (which is what a
// failed spawn, e.g. a non-executable node-pty spawn-helper, produces). Exits
// non-zero on failure so CI fails if the PTY path regresses. Port via MT_PORT.
import WebSocket from "ws";

const port = process.env.MT_PORT ?? "3457";
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: "http://localhost" } });
let sawSession = false;

const done = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} PTY: ${msg}`);
  try {
    ws.close();
  } catch {
    // ignore close errors during teardown
  }
  process.exit(ok ? 0 : 1);
};

ws.on("message", (data) => {
  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return;
  }
  if (frame.type === "session") sawSession = true;
  else if (frame.type === "output" || frame.type === "exit") done(sawSession, `spawned (${frame.type})`);
  else if (frame.type === "error") done(false, `spawn failed: ${frame.message}`);
});
ws.on("error", (e) => done(false, `ws error: ${e.message}`));
setTimeout(() => done(false, `timeout (session=${sawSession})`), 15000);
