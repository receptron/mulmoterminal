# A kept cell whose session ended cannot start a talk (#3276)

## Problem

A cell can stay on screen after its session ended: a crash (#3272), a worktree cell, a startup
failure. It still holds its `sessionId` (only `teardown()` clears it), so `talkAvailable` stayed true
and `exchangeWith` / `startTable` ran. `runOneExchange` reads the dead session's last turn from its
transcript (still readable) and submits it into the live partner cell.

## Scope

- **The starting side only.** A dead cell is already never offered as a TARGET: `readableSlot`
  requires the slot's socket to be open.
- **Not** pulling another cell's turn into a dead cell (`askCell`): it pastes into a terminal with
  no input, which sends nothing anywhere.
- **Not** a partner that dies mid-exchange: that is the running loop's own failure path.

## Design

- `canStartTalk({ sessionId, sessionEnded })` in `src/components/cellTalkStart.ts`, a pure rule.
- **The mark lives on the slot**, in its `connView` state, not in `TerminalCell`: the slot outlives
  the component, and the trip into and out of a collection pane remounts the cell without replaying
  the exit. `applySessionExit` (`connViewFrames.ts`) sets it from an `exit` frame whose `ended` is
  true; a lost client leaves it alone.
- **Only the server's `session` frame clears it** (`applySessionStart`). A restart bumping
  `connectKey` is not yet a session that started, so Talk stays off until the new process is up — and
  stays off if it never comes up. The replay `attach` does on remount is not a frame and clears
  nothing.
- `talkAvailable`, `exchangeWith` and `startTable` all ask the rule, so a panel opened before the end
  cannot start anything either.

## Verification

- Unit: `canStartTalk` both ways; `applySessionExit` / `applySessionStart`.
- Connection manager with a fake socket: an ended exit sets it, a lost client does not, a session
  frame clears it, and it survives detach + attach. Removing either wiring line fails a case.
- Component: no talk row after the end; the row stays on a lost client; a live exchange still starts;
  neither an exchange nor a table starts from a panel opened before the end; a cell mounted on an
  ended slot offers no row; a session on the slot brings it back. Four of these fail on the previous
  `TerminalCell.vue`.
