# fix: a worktree cell the server closed stays as `[session ended]` (#3446)

## Observed

On the #3444 trial, MulmoTerminal closed the implementer after its PR merged (#3428): session ended,
worktree and local branch removed. Its cell stayed in the grid, showing `[session ended]`.

## Cause

The server did ask for the cell to go (`endTmuxSession(..., closeCell: true)` sets
`closeRequested`, and the exit frame says `ended`). But the browser decides from
`shouldCloseEndedCell`, whose first rule keeps any worktree cell — its close asks whether to keep
the worktree, which is not asked unprompted. That rule does not tell an agent that ended on its own
from a session the server ended on purpose, and an implementer always runs in a worktree.

## Fix

- The exit frame carries `closedOnRequest` (the close route's request, already computed in
  `pty-exit.ts`), parsed only from a literal `true`.
- `shouldCloseEndedCell` closes an ended session the server asked to close, before the worktree,
  unrecorded-exit and startup-window rules. Nobody is there to ask about the worktree: the server
  already removed it (an implementer) or it is not a managed one (a reviewer).
- A worktree cell whose agent ended on its own still stays.

Specs: the rule, the frame parsing, the frame `pty-exit.ts` sends, and the cell itself
(`terminalCellEndedExit.spec.ts`). Removing the new rule turns two of them red.
