# fix: a turn opens on a new promptId, not on any user text (#3546)

## Problem

Claude Code writes text into the user channel that nobody typed: a skill's body after a Skill
tool call, the note describing a pasted image. Every transcript reader asked "does this user record
carry text that is not a harness tag?" and took the answer as "this opens a turn", so a skill call
split its turn in two, became the session's latest prompt and emptied the turn's tool names.

## Why not `isMeta`

The issue suggests dropping every `isMeta: true` user record. On a working machine those records
also carry a message from another Claude session (`origin.kind: "peer"`), a ScheduleWakeup / `/loop`
prompt, an auto-continuation and a usage-limit resume, and each of those does open a turn: it comes
after an `end_turn`. Dropping them folds a turn into the previous one. The Library fold already did
this (`conversation-fold.ts`).

## The rule

Claude Code stamps `promptId` on every user record, tool results included, and keeps it for the
whole turn. A skill body and an image note carry the id of the prompt they follow; a peer message
and a wakeup prompt carry a new one. So:

- a META user record with prompt text opens a turn only when it carries a `promptId` other than
  the one of the turn already open;
- any other user record with prompt text opens a turn, as before — the id is not unique to a typed
  prompt: after a resume, Claude Desktop writes its meta "Continue from where you left off." and
  the person's next prompt under one id, and holding typed records to the id dropped that prompt;
- a tagged record (`<local-command-caveat>`, `<command-name>`) never opens one and does not claim
  its id: a slash command's expansion is a meta skill body under the command's id, and it must still
  open that turn;
- a tool result teaches the open turn's id (`continuesTurn`), since it belongs to the turn that
  called the tool. That is what lets a window starting mid-turn recognise the skill body after the
  Skill call's result.

The decision is `opensTurn` in `server/session/transcript/turn-boundary.ts`, pure, with the open id
as the only state. It is taken ONCE per record: it advances the state, so a second caller asking
about the same record would be told "same turn".

## Readers routed through it

- `conversationTurnsFromParsed` and its streaming form (`createConversationTurnScan`): last turn,
  current-turn reply, title window, Library fold, user-turn counts.
- `foldSummary`: user turns, latest prompt, current-turn tool names — one decision shared by all
  three, and the open id kept in the persisted state (summary fold version bumped).
- `foldTranscriptView` (the conversation view): a meta record that does not open a turn renders
  nothing, so a skill's body is not shown as something the user said.
- `transcriptPrompts`.
- `foldTitleField` is unchanged: the first user record with text is asked with no turn open, so it
  always opens one under either rule.
- Library: the `isMeta` drop is replaced by the same rule (index state version bumped).

## Verification

Old readers (`git archive origin/main`) run beside the new ones over the most recent transcripts on
a working machine (`probe/diff.ts`, kept out of the repo): the new user turns are a subsequence of
the old ones, and everything dropped is a meta record in the middle of a turn — skill bodies, image
notes and harness nudges. The summary differs only where those were dropped.

## Left out

- A window that begins exactly at a skill body, or with only assistant records before a harness
  nudge, has nothing in it naming the open turn, so the body still opens a turn there, as before.
  Rejected: treating a meta record seen before any other as non-opening (it would drop the first
  prompt of a session a peer message started) and seeding from the bytes before the window (a
  second read path for a rare case whose outcome is the old behaviour).
- Codex and the other agents have their own readers and are untouched.
