# fix: name the tasks that pass with and without the skill alike (#3530)

## Problem

A use task that passes every time in both arms cannot show what the skill does, yet it counts in both pass
rates and the verdict, and nothing says so.

## Change

- `summarizeSkillEval` adds `passesEitherWay`: the use tasks whose every with-skill attempt passed with the
  skill read, and whose every no-skill attempt passed. A task measured in one arm only is not named.
- The result names them and marks them in the per-task table.
- The drafting skill asks for use tasks an agent without the skill is likely to get wrong.

## Left out

- Dropping such tasks from the verdict: they are real tasks, and removing them silently would move the rates.
- Checks that are high-variance, also flagged by skill-creator's analyzer.
