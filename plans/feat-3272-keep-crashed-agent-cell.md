# Keep a crashed agent's cell, and show how it ended (#3272)

## Problem

#3049 closes an agent cell when its session ends on its own. Under tmux our pty is the tmux
CLIENT, and a client whose session closed exits 0 whatever the program did, so a crash (an OOM
kill, a segfault, `exit 1`) closes the cell exactly like `/exit`: no banner, no trace, just one
cell fewer.

## What tmux can tell us

With `remain-on-exit on` a dead pane keeps `#{pane_dead_status}` / `#{pane_dead_signal}` readable
until it is killed. Measured on tmux 3.6a (macOS): `exit 3` gives `3:`, `kill -9` gives `:kill`,
`kill -SEGV` gives `:segv`. The issue measured the signal as a NUMBER on WSL2, so both forms are
parsed.

## Design

- **Per session, chained onto `new-session`** (`tmux-pane-exit.ts`, `tmuxNewSessionArgs(…, { recordExit })`):
  `; set-option -w remain-on-exit on ; set-hook pane-died "set-option -gqF @mt-exit-<session> '…' ; kill-pane"`.
  - Not in the conf: a global `remain-on-exit` would leave a dead pane in every shell and command
    cell if the hook ever failed, and the conf never reaches a server that is already running.
    Chained, it is in place before the program can die, and under `-A` a session from before this
    change gets it on its next attach.
  - A user option (`@…`), not `set-environment`, so the record is never exported into a pane.
  - No `run-shell`, no file: nothing to quote, nothing on disk. `-q` keeps a failing record from
    ending the list before `kill-pane`.
- **Agents only** (`startAgentPty` sets `recordExit`). A shell's status is its last command's, so a
  shell cell closed by `exit` after a failed command would read as a crash.
- **Not psmux**: whether it runs `pane-died` is unmeasured; it keeps today's behaviour.
- **Read on reap only** (`reportPtyExit` → `tmuxTakePaneExitRecord`, then unset). A `keep` is a
  session still running; a `gone` was ended by us. The recorded code replaces the client's 0 in the
  `exit` frame; a signal becomes 128 + its number.
- **Close rule** (`shouldCloseEndedCell`) gains `exitCode`: non-zero never closes. Both sides use it
  (the browser cell and the server's `markSessionPlaced` for unopened sessions, #3055). The red
  `exitBanner` already existed.

## Verification

- Unit: the parser in both directions, the args, the close rule, `reportPtyExit` with and without a
  record, and that tmux is not asked on `keep` / `gone` / non-tmux.
- Real tmux (skipped without one): the chained hook on a throwaway `-S` server records `0`, `3`,
  `137`, `139`, still ends each session, and leaves a session started without it untouched.
- Real app: scratch `HOME`, `CLAUDE_BIN` pointed at a script that exits on signals, three cells.
  `kill -9` → stays, `[session ended — exit 137]`; `exit 1` → stays, `exit 1`; `exit 0` → closes.

## Not covered

- Whether a real out-of-memory death of Claude Code exits non-zero. If it exits 0 this cannot help.
- psmux, and agents other than Claude whose normal quit might be non-zero (their cell would then
  stay open with a red banner, which is the pre-#3049 behaviour).
- Resuming from the kept cell is unchanged and was not exercised.
