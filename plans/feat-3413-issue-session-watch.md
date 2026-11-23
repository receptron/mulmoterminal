# The watch over startIssueSession's implementers (#3413)

Part two of #3413. Part one (#3416) starts implementers; this follows them and tells the session that
started them what happened, so it never polls (#3403, decision 1: the progress is the server's).

## What it does

Every `ISSUE_WATCH_INTERVAL_MS`, for each implementer not yet finished, the server looks at:

- the newest PR from its branch (`gh pr list --head <branch> --state all`);
- whether its session still runs here;
- whether it stopped on the user: an open question dialog, or the agent's `Notification` hook (claude's,
  and codex's PermissionRequest, which arrives under that name). A turn that merely ended (`Stop`) is
  not this: the implementer may be waiting for its review round, which the server types in.

and types one `[startIssueSession]` line into the starter on news: merged, closed, ended, or waiting
for the user. Merged, closed and ended finish the implementer: it stops holding a place against
`maxIssueSessions`, even while its cell stays open for the user to read.

## Decisions

- **The PR decides first.** A merge that also ended the session is a merge.
- **A stop on the user is told once while it lasts**, and again only after the implementer moved on.
- **A starter that is gone is not typed into**, but its implementers are still followed, so their places
  come back.
- **Delivery is the review loop's** (`deliverWhenFree`, moved out of review-loop-routes.ts unchanged but
  for the log label): retried while a dialog holds the starter's input, never typed after it is gone.
- **One pass at a time**: the next look is scheduled when a pass ends, so a slow gh cannot stack passes.

## Out of scope

- copilot, grok and muse report no block, so for them only merged / closed / ended are seen.
- A plain-text question at the end of a turn looks like any other ended turn; the implementer's skill asks
  with its question tool where it has one.
- Restart: the table is in memory, as part one's is.
