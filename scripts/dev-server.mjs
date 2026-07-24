// Dev backend supervisor — replaces `node --watch server/index.ts`.
//
// Why not `node --watch`: on a CRASH it prints "Failed running... Waiting for file changes
// before restarting" and then just SITS THERE dead until you save a file. In this app that
// means every terminal's WebSocket (and every /api poll) hits a dead port 34567, the Vite
// dev proxy floods the console with `ECONNREFUSED`, and to the user "all terminals
// disconnected at once" — permanently, with no obvious way back. The in-process
// uncaughtException/unhandledRejection guards (server/infra/process-guards.ts) catch RUNTIME
// errors, but a crash at module-import time or an explicit process.exit (e.g. an EADDRINUSE
// bind failure racing a not-yet-dead previous instance on a restart) escapes them — and
// `node --watch` then leaves the backend down for good.
//
// This supervisor instead RESTARTS the backend on any exit (with backoff) and also restarts
// it on a source change — so a crash self-heals in ~1s. Sessions are tmux-backed, so the
// fresh backend transparently reattaches every terminal; the disconnect becomes a blip
// instead of a dead end. `node --watch` re-executes the whole process on each change anyway
// (there is no incremental reload), so a full restart-on-save costs the same here.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWatchDirs, shouldSchedule, isReloadableChange } from "./dev-server-config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Which dirs a source change reloads on (server/ + the common/ and bin/ the backend imports),
// or the single dir DEV_SERVER_WATCH names for the smoke test. See dev-server-config.js.
const WATCH_DIRS = resolveWatchDirs(process.env, ROOT);
// DEV_SERVER_ENTRY overrides the entry (and skips tsx) — used by the supervisor's own smoke
// test to drive a lightweight stub instead of booting the full backend.
const STUB = process.env.DEV_SERVER_ENTRY;
const ENTRY = STUB ? path.resolve(STUB) : path.join(ROOT, "server", "index.ts");
const NODE_ARGS = STUB ? [ENTRY] : ["--import", "tsx", "--env-file-if-exists=.env", ENTRY];

// A crash that recurs within this window is treated as a crash-LOOP: back off (so we don't
// spin at 100% CPU re-crashing) but keep retrying, since a source edit — which triggers its
// own restart below — is usually how the dev fixes it.
const FAST_CRASH_MS = 2000;
const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 4000;

let child = null;
let restartTimer = null; // non-null => a fresh backend is already scheduled; the single guard
let killedForRestart = false; // this child was killed by us (file change), not a crash
let shuttingDown = false;
let delay = MIN_DELAY_MS;
let startedAt = 0;

function log(msg) {
  console.log(`[dev-server] ${msg}`);
}

// Bring up a backend if one isn't running. Every path that wants a (re)start routes through
// scheduleBringUp -> bringUp; the restartTimer guard makes concurrent triggers (a crash that
// lands in the middle of a file-change debounce) collapse to a single spawn instead of racing
// two backends onto port 34567.
function bringUp() {
  restartTimer = null;
  if (shuttingDown || child) return;
  startedAt = Date.now();
  child = spawn(process.execPath, NODE_ARGS, { cwd: ROOT, stdio: "inherit" });

  child.on("exit", (code, signal) => {
    child = null;
    if (shuttingDown) return;
    if (killedForRestart) {
      killedForRestart = false;
      delay = MIN_DELAY_MS; // a deliberate restart, not a crash — come back briskly
      scheduleBringUp(delay);
      return;
    }
    const ranFor = Date.now() - startedAt;
    const how = signal ? `signal ${signal}` : `code ${code}`;
    if (ranFor < FAST_CRASH_MS) {
      delay = Math.min(delay * 2, MAX_DELAY_MS); // crash-loop: ease off but keep trying
      log(`backend exited (${how}) after ${ranFor}ms — restarting in ${delay}ms (crash loop? check the stack above)`);
    } else {
      delay = MIN_DELAY_MS; // it ran a while, so this is a one-off — restart briskly
      log(`backend exited (${how}) — restarting in ${delay}ms`);
    }
    scheduleBringUp(delay);
  });
}

// Idempotent: if a bring-up is already scheduled, do nothing (this is what prevents a crash
// and a file-change from each spawning their own backend).
function scheduleBringUp(ms) {
  if (!shouldSchedule({ shuttingDown, restartPending: restartTimer !== null })) return;
  restartTimer = setTimeout(bringUp, ms);
}

// Restart on a source change. fs.watch fires a burst of events per save, so debounce and
// coalesce. If a child is live, kill it — its exit handler brings up a fresh one (as a
// deliberate restart). If it's already down/restarting, just ensure a bring-up is queued;
// scheduleBringUp is a no-op when one already is. Full restart, matching `node --watch`.
let debounce = null;
function onChange(filename) {
  if (shuttingDown || !isReloadableChange(filename)) return; // ignore editor temp files, etc.
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (shuttingDown) return;
    delay = MIN_DELAY_MS;
    if (child) {
      log(`change detected (${filename}) — restarting backend`);
      killedForRestart = true;
      child.kill("SIGTERM");
    } else {
      log(`change detected (${filename}) — starting backend`);
      scheduleBringUp(MIN_DELAY_MS);
    }
  }, 120);
}

for (const dir of WATCH_DIRS) {
  try {
    watch(dir, { recursive: true }, (_event, filename) => onChange(filename));
  } catch (err) {
    log(`file watch unavailable for ${dir} (${err?.message ?? err}) — auto-reload for it disabled, crash-restart still on`);
  }
}

// Clean teardown so Ctrl-C / concurrently's kill actually stops the backend.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    shuttingDown = true;
    if (child) child.kill(sig);
    process.exit(0);
  });
}

log("starting backend with crash-restart + reload-on-change");
bringUp();
