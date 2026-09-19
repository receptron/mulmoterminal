# fix(#2177 follow-up): the sweep copy names an event, because no clock it could name is true

## Where this comes from

#2183 gave the sweep cadence a Settings control and deliberately left the row copy alone,
reasoning that the saved cadence is not what the running server armed, so the row must not be
keyed off it. That reasoning is right and it stops one step short: the copy it left in place is
false in the same states it was protecting against.

Two reviewers reached this independently — a Codex round on #2186 and my own read — and Codex
then confirmed it string by string against `origin/main`.

## The four states, which are the whole argument

`startReapSchedule` arms the timer **once, at boot**: it takes `intervalHours` as a plain number
while it takes `idleDays` as a `() => number`, and `config-routes.ts` says why — *"re-arming on
every config POST would let a stream of edits reset the countdown forever."* So the SAVED cadence
and the ARMED cadence are different numbers, and the browser only ever receives the saved one.

| armed | saved | `doomed` "ends at next start" | `sweepHint` "…after the next server start" |
|---|---|---|---|
| 0 | 0 | true | true |
| 0 | N | true | true |
| N | N | **false** — the armed timer ends it sooner | **false** — it is already repeating |
| N | 0 | **false** — the old timer runs on | not rendered; the "start only" copy shows, equally wrong |

Keying the row off the saved value — what #2177 originally proposed — fixes row 3 and breaks
rows 1 and 2. That is why #2183 declined it. But leaving the clock in place keeps rows 3 and 4
wrong, and the cadence hint added alongside it is wrong in row 3 too.

**There is no sentence naming a time that is true in all four**, so the fix is not a better
sentence.

## The rule

**Nothing in this section names when the next sweep is.**

- the row names the **event**: `due to be ended`, "the next sweep ends it", "ended by the next sweep"
- the cadence hints state what is **saved**: "Saved: repeats every N hour(s)." / "Saved: at server start only."
- one line, shown in **every** state including the disabled one, says when a change is read:
  "The cadence is read when the server starts, so a change here applies from the next one."

All true whatever was armed. Codex confirmed state by state, and confirmed the consequence:
naming the event means the armed value is **not needed for correctness**. #2184 stays worth
doing — "this server is armed every N hours" is strictly more informative — but it is no longer
the thing standing between the screen and the truth, which is how that issue currently reads.

## The asymmetry the section now states

The threshold does **not** have this problem: `sweepNow` calls `idleDays()` on every tick and
`reapIdleSessions` returns early at `0`, so a saved threshold reaches the running server at once
— including turning an already-armed timer into a no-op. Only the cadence waits for a restart.
That is why one of these two numbers may be described in the present tense and the other may not,
and both the component and the skill now say so.

## Scope

Copy, comments and docs. No behaviour, no new config key, no server change. Five locales, because
#2180 added ko / zh-CN / zh-TW since the strings were written.

The **dated** release pages that quote the old badge (`docs/guide/*/v4.6.1.md`, `docs/ChangeLog.md`)
are snapshots and are left alone, per the repo rule that a dated page is never edited to match new
behaviour.

## The one thing left open, deliberately

The zh-CN / zh-TW files call this sweep 「清扫 / 清掃」. Codex read that as literal
floor-sweeping rather than software cleanup and suggested 「清理」; my own reading agrees. Neither
of us speaks the language, and both of us hedged.

It is **not changed here**, for reasons of scope rather than taste. The term is pre-existing — it
is on `main` at this branch's base in `sweepStepper` and `sweepDisabledHint`, from #2180's
translation of #2183's keys — so it is four occurrences per file, not the two this PR adds, and
those two FOLLOW the file rather than inventing anything. Changing two would leave each file
mixing both words, which is worse than either pure option; changing four means re-translating
another session's strings in a language nobody here reads. Codex accepted the decline and
confirmed it is a register complaint, not a misunderstanding: *"I do not have evidence that
清扫/清掃 is actively wrong or misleading."*

So it is a named question for a native reader: keep the sweep metaphor, or move all four per file
to 清理. Either is a small change; guessing a third time is not.

## Verification

Break-verified against **main's own wording**, source restored byte-identical after each:

- main's clock-naming row copy restored → 4 red
- main's cadence hint restored → 1 red
- the always-shown note removed → 3 red

The row and hint guards run over **both** cadence states and assert the absence of the old
strings, so the clock cannot creep back in one state while passing in the other — which is the
shape both earlier attempts had.
