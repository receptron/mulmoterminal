# Closing a startIssueSession implementer (#3428)

The dispatcher (`mulmoterminal-dispatch-issues`) could start implementers but never close them: when
two stalled in #3420 / #3421 and their PRs were closed, both cells stayed until the user closed them
by hand. This adds the close, as a tool and as what the watch does when a PR ends.

## What it does

- **`closeIssueSession { session, force? }`** — a host tool beside `startIssueSession`. Only the
  session that started the implementer may close it (`entry.parent === caller`). It closes, in order:
  1. every review loop the implementer authored, and its reviewer's cell (what is left when the
     implementer stops before `endReview`);
  2. the implementer's cell (`endTmuxSession(..., true)`, the same close `endReview` uses);
  3. the implementer's local worktree and local branch — the remote branch stays, so the PR still
     leads to it.
- **The watch closes on its own** when it sees the implementer's PR merged or closed, and the line it
  types into the starter says what it closed and what it kept.

## Decisions (from the issue)

1. Both the tool and the automatic close.
2. Only the starter may close (`entry.parent === caller`); no other session in the worktree.
3. The implementer's reviewers are closed with it.
4. A still-working implementer (`finished === null`: no merge, no close, session not seen ended) is
   refused. `force: true` overrides it, for when something is badly wrong. A forced close records the
   implementer as `ended`.
5. The worktree and the local branch are removed — but **not** when the worktree has uncommitted
   changes or commits no remote has (`git rev-list HEAD --not --remotes`), or when either could not be
   read. Then it stays, and the answer says why, so a closed PR does not lose work.

## Shape

- `server/routes/issueSessionClose.ts` — pure: the request, the refusal, the worktree verdict, the
  message.
- `server/routes/issue-session-close.ts` — the close itself, shared by the route and the watch.
- `server/git/implementer-worktree.ts` — reads the worktree's state and removes it (`removeWorktree`
  with `deleteBranch`, then `releaseWorktreeEnv`, as the worktree routes do).
- The review loops map is hoisted out of `mountReviewLoopRoutes`'s deps so the close can reach it.

## Left out

- An implementer whose session ended on its own (`ended`) is not closed automatically: its cell is
  already gone, and its worktree stays until the starter calls `closeIssueSession`.
- No setting to turn the automatic close off; the issue chose to always do it.
