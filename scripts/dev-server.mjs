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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// DEV_SERVER_WATCH overrides the watched dir — used only by the supervisor's own smoke test.
const WATCH_DIR = process.env.DEV_SERVER_WATCH ? path.resolve(process.env.DEV_SERVER_WATCH) : path.join(ROOT, "server");
// DEV_SERVER_ENTRY overrides the entry (and skips tsx) — used by the supervisor's own smoke
// test to drive a lightweight stub instead of booting the full backend.
const STUB = process.env.DEV_SERVER_ENTRY;
const ENTRY = STUB ? path.resolve(STUB) : path.join(WATCH_DIR, "index.ts");
const NODE_ARGS = STUB ? [ENTRY] : ["--import", "tsx", "--env-file-if-exists=.env", ENTRY];

// A crash that recurs within this window is treated as a crash-LOOP: back off (so we don't
// spin at 100% CPU re-crashing) but keep retrying, since a source edit — which triggers its
// own restart below — is usually how the dev fixes it.
const FAST_CRASH_MS = 2000;
const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 4000;

let child = null;
let restarting = false; // a restart is already scheduled/in-flight — don't stack them
let shuttingDown = false;
let delay = MIN_DELAY_MS;
let startedAt = 0;

function log(msg) {
  console.log(`[dev-server] ${msg}`);
}

function start() {
  restarting = false;
  startedAt = Date.now();
  child = spawn(process.execPath, NODE_ARGS, { cwd: ROOT, stdio: "inherit" });

  child.on("exit", (code, signal) => {
    child = null;
    if (shuttingDown) return;
    // A restart we initiated (file change) killed it deliberately — start() is already queued.
    if (restarting) return;

    const ranFor = Date.now() - startedAt;
    const how = signal ? `signal ${signal}` : `code ${code}`;
    if (ranFor < FAST_CRASH_MS) {
      delay = Math.min(delay * 2, MAX_DELAY_MS); // crash-loop: ease off but keep trying
      log(`backend exited (${how}) after ${ranFor}ms — restarting in ${delay}ms (crash loop? check the stack above)`);
    } else {
      delay = MIN_DELAY_MS; // it ran a while, so this is a one-off — restart briskly
      log(`backend exited (${how}) — restarting in ${delay}ms`);
    }
    scheduleStart(delay);
  });
}

function scheduleStart(ms) {
  restarting = true;
  setTimeout(() => {
    if (!shuttingDown) start();
  }, ms);
}

// Restart on a source change. fs.watch fires a burst of events per save, so debounce and
// coalesce: kill the current child (its exit handler is short-circuited by `restarting`) and
// bring up a fresh one. Full restart, matching what `node --watch` did per change.
let debounce = null;
function onChange(filename) {
  if (!filename || restarting || shuttingDown) return;
  if (!/\.(ts|mjs|js|json)$/.test(filename)) return; // ignore editor temp files, etc.
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    log(`change detected (${filename}) — restarting backend`);
    delay = MIN_DELAY_MS;
    if (child) {
      restarting = true;
      const dying = child;
      // When the killed child exits, bring up a fresh one. Not the generic exit handler,
      // which returns early while `restarting` is set.
      dying.once("exit", () => {
        if (!shuttingDown) start();
      });
      dying.kill("SIGTERM");
    } else {
      start();
    }
  }, 120);
}

try {
  watch(WATCH_DIR, { recursive: true }, (_event, filename) => onChange(filename));
} catch (err) {
  log(`file watch unavailable (${err?.message ?? err}) — auto-reload on change disabled, crash-restart still on`);
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
start();
