# Keep a crashed agent's cell, and show how it ended (#3272)

## Problem

#3049 closes an agent cell when its session ends on its own. Under tmux our pty is the tmux
CLIENT, and a client whose session closed exits 0 whatever the program did, so a crash (an OOM
kill, a segfault, `exit 1`) closes the cell exactly like `/exit`: no banner, no trace, just one
cell fewer.

## Design

- **The agent runs under a small `/bin/sh` recorder** (`tmux-pane-exit.ts` `paneExitWrapped`,
  applied by `tmuxNewSessionArgs(…, { recordExit })`). It runs the agent's argv through `"$@"`,
  then writes `$?` to `$HOME/.mulmoterminal/pane-exits/<session>` and exits with it. A death by
  signal N reads as 128 + N.
  - `trap : INT QUIT`, not `trap ''`: an ignored signal stays ignored across exec and the agent
    would lose Ctrl+C. The agents run in raw mode (`-isig`, measured for Claude Code), so a key never
    signals the group at all; the trap is for a program that does not.
  - A file, not tmux state: when the crashed session is the server's last, the server exits too.
  - The path is spelled with `"$HOME"` (the socket is per HOME, so the pane's HOME is ours), so no
    path is quoted into the script.
- **Why not tmux `remain-on-exit` + `pane-died`** (the issue's prototype, and this PR's first
  version): under load the hook sometimes never ran while `remain-on-exit` did, leaving a dead pane
  on screen for good with the session reported alive — worse than today. Measured on tmux 3.4 in
  Docker (a few percent of sessions created concurrently, with or without explicit targets) and
  seen in CI. The recorder cannot do that: when it exits, the pane closes as before.
- **Agents only** (`startAgentPty` sets `recordExit`). A shell's status is its last command's.
- **The session names its agent** (`MULMOTERMINAL_SESSION_AGENT`, set with `new-session -e`), because
  the pane's running command is now the recorder's `sh`. `agentOfSession` reads it for a session with
  no pty (one that outlived a restart) before falling back to the pane's command.
- **Not psmux**: its panes are started by Windows, with no `/bin/sh`. Unchanged.
- **Read on reap only** (`reportPtyExit` → `tmuxTakePaneExitRecord`, which removes the file). A
  `keep` is a session still running; a `gone` was ended by us. The recorded code replaces the
  client's 0 in the `exit` frame.
- **A stale record** (written while no server was there to read it) is dropped before a NEW
  recording session starts under the same id, since ids are reused by restart and reopen.
- **Close rule** (`shouldCloseEndedCell`) gains `exitCode`: non-zero never closes. Both sides use it
  (the browser cell and the server's `markSessionPlaced` for unopened sessions, #3055); a shell pty
  (launcher, bot job) is decided without its code. The red `exitBanner` already existed.
- **A kept cell stops its automation**: an exchange or round table it started stops when its session
  ends, since `teardown()` no longer runs for it.

## Verification

- Unit: the record parser both ways, the wrapper argv, the close rule, `reportPtyExit` with and
  without a record, `agentOfSession`'s fallback order, the stale-record discard, the cell's
  automation stop and crash-stays.
- Real tmux (skipped without one): the recorder records `0`, `3`, `7` (instant), `137`, `139`, the
  server's last session, a Ctrl+C the program survives, passes tricky argv untouched, and leaves no
  session or dead pane when many end together.
- Docker, tmux 3.4, one CPU: many sessions created concurrently, several rounds — no dead pane, no
  session left, every record correct (the same load left dead panes with the hook design).
- Real app, scratch `HOME`, `CLAUDE_BIN` → a script that exits on signals: `kill -9` → stays,
  `[session ended — exit 137]`; `exit 1` → stays; `exit 0` → closes; a single cell killed with `-9`
  stays with the tmux server gone.
- Real Claude Code under the recorder: starts, renders, runs as the recorder's child, tty in raw mode.

## Not covered

- Whether a real out-of-memory death of Claude Code exits non-zero. If it exits 0 this cannot help.
- A real Claude Code `/exit` or double Ctrl+C under the recorder: the scratch HOME has no login, and
  the first-run screen ignores Ctrl+C with or without the recorder (control run).
- psmux, and agents other than Claude whose normal quit might be non-zero (their cell would then stay
  open with a red banner, the pre-#3049 behaviour).
- A kept cell can still START an exchange or table from its dead session — pre-existing for every
  kept cell (worktree, startup failure, before #3049).
- A record whose session died while this server was down stays (a few bytes) until a new session
  under the same id starts.
