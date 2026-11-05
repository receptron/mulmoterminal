# The ended mark is cleared by a running process, and set by a failed start (#3280)

## Problem

#3277 put a `sessionEnded` mark on the terminal slot so a kept cell cannot start a talk from a dead
session. It cleared the mark on the server's `session` frame. Two holes, from CodeRabbit on the
merged head:

- The server sends `session` during admission (`announceSession`), BEFORE `startAndWire` spawns. A
  restart therefore re-enabled Talk before its new process ran.
- A start that fails after that frame sends `error`, which `sessionExitOf` reads as "not ended", so
  the mark stayed cleared on a cell with no agent.

## Design

- `applySessionExit(view, msg)` marks on an `exit` whose `ended` is true, or on any `error`. A lost
  client (`ended: false`), a frame without the field and `superseded` (alive elsewhere, and never
  reaches it: `callsOnExit` is false) mark nothing.
- `applySessionOutput(view)` clears it, called for every `output` frame. Output comes from a running
  pty: the live relay, the replay on a reattach, or the notice printed as a switched process starts
  (a spawn that then fails is followed by `error`, which marks again). The `session` frame no longer
  touches the mark.
- The output path is hot, so the clear only writes when the mark is set.

## Verification

- Unit (`connViewFrames.spec.ts`): marking by ended exit and both error shapes; not by a lost
  client, a missing field, `superseded`, an empty frame; cleared only by output.
- Connection manager with a fake socket: the mark survives a restart's `session` frame, is set by an
  `error` after `session`, and is cleared by output. The first two fail on main's manager; removing the
  output clear or the `error` case fails a case each.
