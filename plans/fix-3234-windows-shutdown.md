# fix: every way of stopping runs the server's own shutdown, on Windows too (#3234)

## Problem

On Windows a signal sent to ANOTHER process is TerminateProcess, so the server's SIGINT/SIGTERM
handler — which drains the queued session-state writes before exiting (#2161) — never ran for:

- Ctrl+C in the launcher's terminal (`installParentShutdown` sent `child.kill("SIGTERM")`; the
  child also gets the console's Ctrl+C itself, so this was a race the kill usually won),
- `mulmoterminal stop` (`process.kill(pid, "SIGTERM")`),
- `yarn dev`'s Ctrl+C and its restart-on-save (`child.kill`, then `process.exit(0)` at once),
- and the browser's Stop button, which the issue did not list: the route sent SIGTERM to its OWN
  pid, which on Windows is TerminateProcess as well.

## Fix

- `server/infra/process/shutdown.ts`: `requestShutdown()` is the one entry, latched so it runs once.
  The signal handlers, the route and an IPC `{ type: "shutdown" }` message all call it.
- `bin/child-shutdown.js` (new, shared by the launcher and `scripts/dev-server.mjs`):
  `askChildToStop` sends the message over the IPC channel both parents already open, falling back
  to SIGTERM without a channel; `stopChildWithin` adds the cap, past which the child is SIGKILLed
  (asking no longer comes with a signal that would have ended it); `installParentShutdown` moved
  here from `bin/mulmoterminal.js` unchanged apart from using them.
- `bin/stop.js`: POST `/api/shutdown` on the instance's port first (the Origin the browser sends),
  SIGTERM when it is not answered. Not under `--force`: the pid is unconfirmed then, so the server
  answering on that port may be a different one.

## Left out

- `yarn dev` under `concurrently` on Windows: concurrently ends its children with
  `taskkill /T /F`, which kills the backend regardless. `node scripts/dev-server.mjs` alone is
  fixed, and so is restart-on-save under `yarn dev`.
- Restart-on-crash supervision stays off on Windows: a `taskkill` still looks exactly like a crash.
