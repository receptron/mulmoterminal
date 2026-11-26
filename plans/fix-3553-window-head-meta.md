# fix: a read window that begins at a skill body does not take it for a prompt (#3553)

Follow-up to #3546 / #3550. That fix decides a turn boundary from `promptId`, learning the open
turn's id from the records before a meta record. A read that starts partway through a transcript
has none of them at its very first record, so a skill body there still opened a turn.

## The signal that needs no history

Claude Code writes `promptSource` on every SUBMITTED prompt: `typed`, `sdk`, `queued`,
`suggestion_accepted`, and `system` for a peer message, a scheduled prompt and an
auto-continuation. Text it writes into a turn — a skill's body, an image note, a compaction
summary, an interrupt, a harness nudge — never carries it. Neither does a slash command: its
`<command-message>` record is followed by the expansion (a meta skill body) under the same
`promptId`, and neither carries `promptSource`.

## The rule

`TurnBoundaryState` gains `known`. A read from the file's start begins known (`emptyTurnBoundary`),
which is the rule #3550 shipped. A read that starts mid-file begins unknown (`windowTurnBoundary`):

- a submitted meta record (`promptSource`) opens a turn, here as anywhere;
- an unsubmitted meta record opens nothing while the open turn is unknown, and its id becomes the
  open one;
- a tool result names the open turn (as in #3550);
- a `<command-…>` record ends the unknown state without claiming its id, so the expansion after it
  opens the slash command's turn;
- a typed record opens a turn, as everywhere.

## Where a read starts mid-file

- the conversation view's byte window (`readWindow`, `from > 0`), handed to the source's fold
  factory as `{ fromFileStart }`;
- the Claude tail reads in `session-reads.ts` (latest prompt, last turn, current-turn reply, the
  prompt-history fallback), through `readTailWindow`, which reports whether the tail began at byte 0.

The whole-file folds (summary, title, Library) always begin known. Their state shape gained a
field, so the summary fold and the Library index versions are bumped.

## Verification

- Windows cut at regular intervals from real transcripts (`probe/window2.ts`, kept out of the repo):
  openings in each window compared with the whole file's over the same records, in both directions.
- The whole-file comparison against the readers before #3550 is unchanged.
- `sessionTranscriptView` on a real transcript with a byte window starting at the skill body's line:
  on main the body opens a turn; here it is dropped as the fragment before the first turn.
