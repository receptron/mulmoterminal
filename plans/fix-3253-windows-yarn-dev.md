# fix: `yarn dev`'s Ctrl+C on Windows no longer force-kills the backend (#3253)

## Problem

`yarn dev` ran the backend supervisor and Vite under `concurrently`. On Ctrl+C, concurrently ends
each child through `tree-kill`, which on Windows is `taskkill /pid <pid> /T /F`: the backend is
killed with its tree before it flushes queued session state (#2161). concurrently has no option to
leave its children alone on a signal (`--kill-signal` changes nothing there).

## Fix

- `scripts/dev-plan.js` (pure): on Windows the two scripts are started as `node <script>` — no
  shell, since `vite` there is `vite.cmd` and a batch file answers Ctrl+C with "Terminate batch job
  (Y/N)?"; elsewhere
  `concurrently` runs with exactly the arguments `yarn dev` had, so macOS and Linux keep the
  prefixed, coloured output.
- `scripts/dev.mjs` (`yarn dev` now runs it): starts the plan, does NOT pass a Ctrl+C on — every
  process in the terminal receives it and each stops itself, the backend after its flush — and
  leaves only when its commands have ended. A SIGTERM is aimed at it alone, so that one is passed on.

## Verified

- Specs: the plan per platform, and the runner as a process against stubs (a SIGINT is not passed
  on and the runner waits; a SIGTERM is).
- A real `yarn dev` on macOS in its own process group with SIGINT to the group: the backend exited 0
  through `dev-server.mjs`, Vite exited, nothing was left.
- Not run on Windows.

## Left out

- On Windows the two commands' output is not prefixed.
