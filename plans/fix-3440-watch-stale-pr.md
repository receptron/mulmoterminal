# fix: the dispatcher's watch counts an earlier attempt's PR, and loses a PR from another branch (#3440)

## Observed

Re-running the dispatcher on #3420 / #3421 after #3425, it was told both PRs were "closed without
merging" (#3423, #3422 — both closed by the previous trial) and "0 of 2 implementers are running"
while both still ran. The #3421 implementer reopened #3422; the #3420 one opened #3439 from a new
branch and merged it, which the watch never saw.

## Cause

- `fetchBranchPr` lists the worktree branch's PRs with `--state all` and takes the newest. The
  issue's branch keeps its name across starts, so a PR an earlier attempt closed is found and ends
  the implementer.
- `mulmoterminal-issue-to-merge` only says to branch from the default branch; started by another
  session, it may cut a new branch, and the watch follows the worktree's branch only.

## Fix

- `IssueSession.startedAtMs`, taken when the start begins (`now` injected). The watch passes it to
  `prOf`; `parseBranchPr(stdout, sinceMs)` skips a CLOSED or MERGED row whose end time
  (`mergedAt`, else `closedAt`) is before it. An OPEN row always counts (a reopened PR); a row whose
  end time is missing or unparsable counts, as before.
- The seed and the skill: when another session started you, work on the worktree's branch and open
  the PR from it; update it by merging the default branch, never by switching branches.

Specs cover each side of the time rule and the wiring; both fixes were mutated out and went red.
