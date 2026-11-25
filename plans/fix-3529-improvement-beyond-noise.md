# fix: say whether an improvement beats chance (#3529)

## Problem

The improvement panel showed "now X → improvement Y" and the next step pointed at Adopt whenever Y > X.
On `product-article-ja` that was 67% → 100%, while the baseline's own rounds moved by 2/3.

## Change

- `common/skillEvalCompare.ts` (pure) `compareImprovement(baseline, improvement)`:
  - **gap:** the with-skill pass rate on use tasks, counted only when the skill was read, improvement minus baseline.
  - **spread:** the wider of the two runs' with-skill round spreads.
  - **verdict:** better / worse only past the spread and one task's worth, else no evidence; pending when either has nothing.
  - **worse tasks:** the tasks the improvement passed less often, avoid tasks counted only when the skill stayed unread.
- The rule is the summary's own (`verdictOf`, `roundSpread`, `oneCaseWorth`, now exported). The summary is
  unchanged: an old/new differential over generated inputs agreed on every one.
- `skillEvalNext` points at Adopt only for `better`; otherwise at improving again.
- The candidate panel says which of the four it is and names the worse tasks. Adopt stays available.

## Left out

- Requiring repeated wins (BiPA's stronger gate): that costs extra runs.
