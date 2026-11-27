# feat: a review finding holds the verdict only with evidence (#3590)

## Problem

`server/skills/mulmoterminal-review/SKILL.md` §5 asks the reviewer to confirm each finding, but lets an
unconfirmed one be reported at any severity. LGTM needs nothing above N outstanding, so one "this could
break if…" costs a whole round. §6 only demotes rare edge cases in later rounds, by the reviewer's feel.

## Change

- §5: a sixth part, **Evidence** — a run (command and output), a static proof (the real entry point
  and caller AND the code fact that makes the result wrong), or a quoted rule or claim beside the line
  that contradicts it. Reachability alone is not evidence. A finding without it is marked
  `UNVERIFIED` and reported as N.
- `reviewPrompt()` (`server/routes/reviewLoop.ts`), the message `requestReview` types to every
  reviewer, lists N beside P1/P2/P3, so it no longer offers only blocking severities.
- §6: an earlier finding re-checked on the new head meets the same bar; REOPENING needs evidence.
- §7: the findings list shows the evidence; UNVERIFIED notes sit with the N notes.

## Decisions

- Demote to N, not P3: P3 still holds LGTM under §7, so P3 would change nothing.
- A static proof counts, so a race or a Windows-only path the reviewer cannot run can still be P1/P2;
  it must name what is wrong at the line, not only that the line is reached.
- A rule or claim finding is proved by quoting it, since there is nothing to run.
- The prompt gains N only. The evidence rule stays in the skill, because a repository can name its own
  skill and the prompt is shared by all of them.
- Reuse the `UNVERIFIED` word §2 already uses for claims that depended on something not run, instead
  of a second label.
- Out of scope: the LGTM condition, `requestReview` and the `review` config, and the user's own
  `codex-cross-review` skill outside this repo.

## Verify

`yarn test test/server/infra/fs/install-bundled-skills.spec.ts test/server/routes/reviewLoop.spec.ts`,
plus the repo's format, lint, typecheck and build; CI for the rest.
