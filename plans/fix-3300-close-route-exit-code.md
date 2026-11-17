# fix #3300: the close route leaves the cell as `[session ended — exit 1]`

## Problem

`POST /api/session/:id/close` (#3067) marks the entry `closeRequested`, then reaps. The reap SIGHUPs the
tmux client before killing the session, and a tmux client exits 1 on SIGHUP. The exit is `gone`, so
`programExitCode` passes the client's 1 through as the program's, and the crash rule from #3274 keeps
the cell on a non-zero code.

## Fix (option (a) in the issue)

A `gone` exit with `closeRequested` set reports exit code 0: the server ended the session on purpose,
so neither the client's code nor the pane-exit record says anything about the program.

- `closedOnRequest(disposition, closeRequested)` — pure, in `server/session/pty/pty-exit.ts`. Both
  `sessionEndedForCell` and `programExitCode` decide from it, so "the close route ended it" is one rule.
- Keyed on `closeRequested`, not on `gone`: `terminate` (restart #1918, token switch #2950) also exits
  `gone`, keeps its cell either way, and keeps passing the client's code through.

Option (b), killing the tmux session before the client in `reap()`, was not taken: it reorders every
reap and relies on the client's exit code in a different order instead of on the request.

## Tests

`test/server/session/pty/pty-exit.spec.ts`: the close-route cases now exit with the client's real
code (1) instead of 0 — the case that regressed passed because the fixture used 0. Added a table for
`closedOnRequest` and a case pinning that a `gone` exit without the request keeps the client's code.
