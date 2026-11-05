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
- `TerminalCell` keeps `sessionEnded`: set by an `exit` frame whose `sessionEnded` is true (not a
  lost client), cleared on every `connectKey` change — launch, resume and restart all reconnect
  through it.
- `talkAvailable`, `exchangeWith` and `startTable` all ask the rule, so a panel opened before the end
  cannot start anything either.

## Verification

- Unit: `canStartTalk` both ways.
- Component: no talk row after the end; the row stays on a lost client; neither an exchange nor a
  table starts from a panel opened before the end; a restart brings the row back.
- Each component case fails on the previous `TerminalCell.vue`; removing the `connectKey` reset
  fails the restart case.
