# feat: the board shows the review verdicts and "ready to merge" (#3409, part C)

Part C of #3409.

- The verdict badge says "Verdict" rather than "Codex": the review loop (#3410) asks any reviewer
  agent for a `REVIEW VERDICT:` line, which the board already counts beside `CODEX VERDICT:`.
- A PR whose repository declares `review` (#3407) and whose current head has the required LGTMs with
  CI passing is marked **Ready to merge** — the same condition requestReview reports
  (`mergeConditionMet` in `common/githubBoard.ts`, so the server and the card share it).
- `BoardCodexReview.lgtmOnHead` counts trusted LGTMs naming the head; `BoardPr.requiredLgtm` is the
  repository's declared count, read per repo when the board is built (`server/git/repo-review.ts`).
  A setting that cannot be read is treated as none: no mark rather than a wrong one.
- A draft, a merged card, and a repository without `review` are never marked.
