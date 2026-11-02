# fix: a cell under `volta run` inherits Volta's recursion marker (#3233)

`volta run` sets `_VOLTA_TOOL_RECURSION=1` on the process it launches. A Volta shim that sees it
skips Volta's own version choice, so `yarn` in a cell fails with "Node is not available" and `npm`
is the bundled one rather than Volta's. Only psmux scrubbed the name (`PSMUX_SCRUBBED_NAMES`); a real
tmux kept it in the client, the server's global environment and every pane.

## Order of work

1. Red first: unit specs for the three places a real tmux can carry it (`isLauncherEnvVar`,
   `sanitizePtyEnv`, `isScrubbedGlobalEnvEntry`), plus `voltaCell.spec.ts`, which runs only in the
   `volta` workflow (real Volta, real tmux, a project pinning yarn).
2. Fix: name the marker with the other launcher variables, so one list covers the client, the running
   server's global environment and the throwaway probe server.
3. Left for a second PR, with its own red test: Volta's image dirs staying at the front of PATH
   (the second half of the issue).

## Limits

The workflow drives `throwawayTmux`, which builds its environment with `sanitizePtyEnv` as a real
spawn does, but it does not go through `ptySpawn` itself.
