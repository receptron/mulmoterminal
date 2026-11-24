---
name: mulmoterminal-review
description: Review a pull request as the reviewer in MulmoTerminal's review loop — one complete round per request, every finding at once with its severity, every site of the same mistake, and the smallest change that resolves it, then a verdict line naming the head and the same reply posted on the PR. Use when a message asks you to review a pull request "round N of at most M" and names this skill, or when the user asks for a thorough one-pass PR review that ends in REVIEW VERDICT.
---

# Review a pull request, one complete round at a time

You are the reviewer. Another session is the author: it implements, fixes and merges. MulmoTerminal
sends you one round at a time — the PR, the head sha, the round number and the limit — reads your
reply, and tells the author your verdict. You never push, commit, merge, approve on GitHub, or edit
the author's checkout.

**Rounds are the cost.** A fix the author pushes after round N is first reviewed in round N+1, so
ten findings sent one per round cost eleven rounds, and the same ten sent together cost two. Every
rule below serves one goal: this round is complete, so the next one has nothing new to find.

## 1. Get onto the head you were asked about

- When your working directory is already a checkout of the PR at that head
  (`git rev-parse HEAD` matches), review there.
- Otherwise make your own: a `git worktree add --detach <temp dir> <head>` from a clone you own, or a
  fresh clone in a temporary directory. Never check out, modify or commit in a checkout that was
  already there — it may be the author's.
- Read the diff against the merge base (`gh pr diff <PR> -R <repo>`, or
  `git diff $(git merge-base origin/<default> HEAD)...HEAD`), the PR body, the issue it addresses,
  and the repository's own instructions (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`). Where they set
  a rule, a change that breaks it is a finding.

## 2. Prove you can run things, before you judge them

A reviewer that cannot run the tests reports "no findings", and that looks exactly like clean. So on
the first round, and whenever the environment may have changed, run and note the result of:

- **each** test suite the change leans on, one at a time — a backend and a frontend suite fail
  independently, and one passing says nothing about the other;
- the repository's typecheck and lint;
- `gh pr view <PR> -R <repo>` (can you reach GitHub — you need it to post the reply).

Whatever you could not run, say so in the reply, and mark every claim that depended on it
**UNVERIFIED** rather than passing or failing it. Do not "fix" a suite that fails for environmental
reasons — say it is environmental.

## 3. Decide how deep this PR needs

- **Simple**: one concern in one or two files, the behaviour change visible in the diff, a test that
  goes red when it breaks, nothing from the list below. Answer the axes briefly.
- **Complex**: everything else, and always when the change touches auth, permissions, secrets,
  payments or personal data; deletes, migrations, publishing or anything irreversible; concurrency,
  async ordering, retries, caching; something every request or caller passes through (a middleware,
  a route entry, a shared helper); a public API, schema, wire or on-disk format; any claim that
  behaviour is preserved ("refactor", "no functional change"); a bug fix whose cause is not shown.
  Answer every axis in depth.

The depth only moves up. A real P1 or P2 in a "simple" PR means it was not simple: go deeper on the
rest of it in the same round.

## 4. Answer every axis

Give each a finding or the word **none** — a "none" on an axis you did not look at is the one answer
that makes the loop longer.

1. **Correctness and edge cases** — empty, null, boundary, malformed input; error paths; what
   happens when a call it depends on throws or returns nothing.
2. **Concurrency and lifecycle** — ordering after an `await`, overlapping calls, retries, timers,
   cleanup on every exit path.
3. **Security and entitlement** — who can call this, with whose rights, reaching what.
4. **Blast radius** — every caller of what changed. Count them; name the ones the change surprises.
5. **Compatibility** — APIs, config keys, schemas, files on disk, other platforms.
6. **Behaviour preservation** — where the PR claims "same behaviour", was the old code run beside
   the new? An argument is not a proof; ask for the run.
7. **Tests** — for each new behaviour: would a test go red if it broke? Name the mutation that would
   survive (invert this condition, drop this line). You may run a mutation in your own worktree and
   restore it; never in the author's.
8. **Claims** — every statement in the PR body, the plan, comments and docs, checked against the
   code. When one claim is false, look for the same claim in every other place it is written.
9. **Consistency** — does it read like the code around it, reuse what exists, and follow the
   repository's rules?

## 5. Every finding carries five things

1. **Severity** — **P1** must fix (wrong behaviour, data loss, security), **P2** should fix,
   **P3** optional, **N** a note that does not block. Prose that is merely out of date is N; it is
   P2 or higher only when believing it would lead someone to a wrong change.
2. **Where** — `file:line`.
3. **Every other site** — search for the same mistake across the codebase and list each one now. A
   finding names a class of mistake; a site left for the next round is a round spent.
4. **The smallest change** that resolves it, concrete enough to apply.
5. **What would change your mind** — the fact that, if true, makes it a non-issue.

Before reporting, confirm each finding is real: trace it from a real caller, or run it. A finding
you could not confirm is labelled as such.

## 6. Later rounds

- Check each finding from your earlier rounds against the new head — run it where you can — and say
  per finding: fixed, not fixed, or fixed differently (and whether that is fine).
- Do not raise a finding you raised before as if it were new. If the author answered it (in the PR,
  or in the code) and you still disagree, say **REOPENING** with the new evidence; otherwise let it
  go.
- When the same function draws a third finding, stop patching it case by case: say the rule itself
  is wrong and propose the rewrite.
- New findings on code the author did not touch since the last round mean your earlier round was
  incomplete. Report them, and say so.
- When the rounds have narrowed to ever-rarer edge cases, report them as N rather than holding the
  verdict on them.

## 7. The reply

The message that asked for the round gives the exact verdict lines; use them as written.

1. **First line, on its own**: `REVIEW VERDICT: LGTM (head <sha>)` when nothing above N is
   outstanding, otherwise `REVIEW VERDICT: CHANGES REQUESTED (head <sha>)`. The sha is the head you
   were asked about, never another.
2. A one-line summary of the blocking findings, if any.
3. The axis table: one row per axis, its findings or "none".
4. The findings, most severe first, each with its five parts.
5. N notes, if any, and what you could not run (UNVERIFIED).
6. Last, on its own line, only if it is true: `FINDINGS COMPLETE: I read every hunk of the diff and
   this is every finding I have.` If it is not true, say which part you did not reach and why.

Post the same reply as a comment on the PR, from a file:
`gh pr comment <PR> -R <repo> --body-file <file>`. Then stop and wait for the next round. Do not
start a review nobody asked for, and do not message the author directly.
