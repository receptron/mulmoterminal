# fix: a reattached codex with no mapping adopts the rollout it holds open (#3283)

## Problem

A tmux reattach of a codex cell whose `codex-rollouts.jsonl` mapping is missing ran the
appear-watcher, which only considers rollouts created after its snapshot. A rollout that already
existed (the mapping lost by #3282's deadline, or written while the server was down) was never
found, so the cell's working state and finished-turn notice never came back.

## Evidence instead of a guess

Picking among existing rollouts by cwd is the mis-attribution #1533 forbids. The running codex
process is the evidence: measured on codex-cli 0.156.1, it holds its own rollout open for the life
of the process, idle between turns included, read-write (`lsof` access `u`), and two codex
processes on one `CODEX_HOME` and cwd each hold a different file.

## Change

- `server/agents/codex/codex-open-rollout.ts`: `pickOpenRollout` (pure) — the one rollout of this
  session's root among open paths, re-spelled under the root as the server lists it (lsof prints
  the resolved path). Two distinct rollouts, or one claimed by another cell: nothing.
- `server/infra/process/open-files.ts`: one `lsof -F an` call with a timeout, keeping only files
  held for writing (a reader such as `tail` is not the writer); any non-zero exit, a timeout or a
  truncated listing included, is "cannot tell".
- `server/session/spawn/agents/codex-open-rollout-recovery.ts`: the session's tmux panes, the
  process tree under them (`processTree`, `childrenByParent` from session-cpu), their open files.
  Listings injected.
- `spawn-codex.ts`: the unmapped reattach branch first tries to adopt the open rollout — claimed
  and recorded, then tailed from the end with the open turn restored, as a mapped reattach. Never
  read whole: the snapshot lists only today's and yesterday's folders and codex fixes a rollout's
  folder at session start, so "not in the snapshot" cannot tell a new rollout from a days-old one,
  and reading an old one whole announces every finished turn again. The cost is a first turn that
  starts and ends inside the probe's moment. A conversation the log maps to another session is
  refused. No adoption (no
  first turn yet, ambiguous, claimed meanwhile, the pty replaced, or a probe failure) falls back to
  the appear-watcher with the original snapshot, so a first rollout still appearing is still found.

## Not changed

psmux (no lsof, no reattach of this kind). A cell whose codex has ended is not this path.

## Verified

- Specs for the rule, the lsof parse, the walk, and the spawner's branch (adopt, claimed meanwhile,
  pty replaced, probe failure, no open rollout). Six mutations of the rule and the wiring each fail
  a spec.
- Real codex 0.156.1 under a scratch HOME and tmux: a rollout written while the server was down,
  mapping absent. `main`: after restart the mapping stays empty and the next turn shows no
  activity. This branch: the mapping is restored with the rollout's own id, activity is idle right
  after the restart (no finished turn replayed), and the next turn reads working then Stop.
