---
name: blueprint-refactor-report
description: "Write up what this campaign changed, how each change was proved, what was not proved, and what was declined and why."
---

# The record you leave

The next person reads this instead of rediscovering it. Write `.blueprint/refactor-report.md` in Japanese,
from `.blueprint/targets.json`, `.blueprint/spec.md` and the pull requests themselves (`gh pr view <url>`).

0. **Measure after**: `CI=true npx -y scoria --json --no-write > .blueprint/scoria-after.json`, if
   `.blueprint/scoria-before.json` exists. Open the report with a table of each dimension before and after,
   and the overall. For every dimension whose score fell, name it and say why — a measurement scale that is
   experimental, a probe that saw more files, or a real regression (then say which change caused it). If the
   detection (`profile`, `stacks`) differs between the two runs, say the scores are not comparable.
1. **Per target**, by its id: what was done, the pull request, how behaviour was proved (replica over
   generated inputs, driven through a seam, or only the verbatim body — say which), which mutations went red,
   and **what was not proved**.
2. **Declined targets**: the cost written down, and the open question the next attempt has to answer.
3. **Not looked at**: the parts of the repository the survey did not cover.
4. **Candidates left** for a later run, if the survey found more than this run's limit.

The scoria table is a measurement, so its numbers belong in it — the two JSON files are where they come
from. Everywhere else, say what moved and how, never by how much. Nothing in this step changes the repository.

Done when the check passes: the report exists and names every target.

## Always

- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
