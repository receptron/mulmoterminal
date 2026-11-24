# README: requestReview starts the reviewer (#3444)

The API table's `POST /api/plugin/:toolName` row said `requestReview` runs a round "in the reviewer
session" without saying where that session comes from. Since #3430, leaving `reviewer` out makes
MulmoTerminal start the repository's declared reviewer in a worktree of the PR's head and keep it for
the PR's later rounds.

Change: one clause in that row, worded after the `requestReview` description in
`server/infra/tools/review-loop-tools.ts`. Docs only; no code.
