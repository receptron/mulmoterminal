# feat: a review finding holds the verdict only with evidence (#3590)

## Problem

`server/skills/mulmoterminal-review/SKILL.md` §5 asks the reviewer to confirm each finding, but lets an
unconfirmed one be reported at any severity. LGTM needs nothing above N outstanding, so one "this could
break if…" costs a whole round. §6 only demotes rare edge cases in later rounds, by the reviewer's feel.

## Change

- §5: a sixth part, **Evidence** — the command run and what it printed, or the call chain from a real
  entry point naming the caller that supplies the input (the two ways `~/.claude/CLAUDE.md` accepts to
  establish a bug is real). A finding without it is marked `UNVERIFIED` and reported as N.
- §6: an earlier finding re-checked on the new head meets the same bar; REOPENING needs evidence.
- §7: the findings list shows the evidence; UNVERIFIED notes sit with the N notes.

## Decisions

- Demote to N, not P3: P3 still holds LGTM under §7, so P3 would change nothing.
- A traced chain counts, so a race or a Windows-only path the reviewer cannot run can still be P1/P2.
- Reuse the `UNVERIFIED` word §2 already uses for claims that depended on something not run, instead
  of a second label.
- Out of scope: the LGTM condition, `requestReview` and the `review` config, and the user's own
  `codex-cross-review` skill outside this repo.

## Verify

Skill text only. `yarn test test/server/infra/fs/install-bundled-skills.spec.ts`; CI for the rest.
