# feat: MulmoTerminal starts the reviewer, on the PR's head, with network for codex (#3425, part B)

## Why

Trying the dispatcher on #3420 / #3421 showed three things about the reviewer the author started with
`spawnBackgroundChat`: it ran in the workspace, with no checkout of the PR; a codex reviewer had
the user's default sandbox, so every `gh pr view` / `gh pr diff` stopped on an approval prompt; and
the author had to start it, remember it and start another when it stopped.

## What

- `requestReview { repo, pr }` without `reviewer`: the loop's reviewer when it has one still running,
  else MulmoTerminal starts one (`routes/review-workspaces.ts`):
  - fetches `pull/<pr>/head` into the repository's clone and checks the head out, detached, in
    `~/.mulmoterminal/review-worktrees/<owner>-<repo>-pr<N>` (`git/review-worktree.ts`) — outside
    the managed worktrees root, so it is no task and gets no worktree env;
  - spawns the declared agent there through `spawnIssueSession`, with the round's request as its
    first message, records it as the author's, and makes it a visible cell;
  - codex only: `-c sandbox_workspace_write.network_access=true` for that spawn
    (`CODEX_NETWORK_ACCESS`). A codex cell the user opens keeps the user's sandbox.
- A later round moves the worktree to the new head before the request is typed in. A reviewer that
  stopped is replaced on the next request; the rounds counted stay counted.
- `endReview` closes the reviewer, then removes the worktree; so does dropping the loop of an author
  that is gone. A reviewer still running after the close keeps its worktree.
- Naming `reviewer` still works as before.
- The implementer skill no longer starts a reviewer.

## Verified

- Specs: route paths (start, reuse, move-before-send, move failure, stale reviewer replaced, start
  failure, refusals before any start, end and author-gone removal), the git calls, the workspaces,
  the codex argument, the spawn option.
- On a scratch-HOME server from this checkout, against PR #3429: the worktree was made on the PR's
  head, the reviewer's pane ran in it and was recorded and visible; a reviewer that exited was
  replaced in the same worktree; `endReview` closed it and removed the worktree.
- Not run: a codex reviewer (codex is not spawned on a scratch HOME), so the network argument is
  covered by specs only; a logged-in reviewer answering a round.
