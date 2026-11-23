# The dispatcher's skill (#3413)

Part three of #3413, on #3416 (startIssueSession) and #3417 (the watch). `mulmoterminal-dispatch-issues`
is what a workspace session follows when the user names several issues:

1. Take the list exactly as given — no issue the user did not name (#3402: only what is declared).
2. `reviewSettings` per repository; a repository with none is settled with the user first, since its
   implementers would stop at their review step.
3. `startIssueSession` in the user's order until the limit refuses; the rest is the queue.
4. Do not poll. Act on each `[startIssueSession]` line: merged → start the next; closed / ended → tell the
   user, start the next, never restart on its own; waiting → tell the user which cell, never answer for them.
5. A report per issue when everything finished.

`mulmoterminal-issue-to-merge` gains one paragraph: an implementer another session started asks with its
question tool where it has one, because a plain-text question at the end of a turn is indistinguishable,
to the watch, from a turn waiting for its review round.
