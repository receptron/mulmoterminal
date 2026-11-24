# docs: list the session-to-session tools in the README API table (#3421)

The `POST /api/plugin/:toolName` row named only `spawnBackgroundChat`, `manageAccounting` and
`presentHtml`. Append the tools added for the review loop and the issue dispatcher
(`sendToSession`, `waitForSessionReply`, `reviewSettings`, `requestReview`, `endReview`,
`startIssueSession`), one phrase each, and link to `docs/guide/en/config.md#dir-review` and
`#max-issue-sessions` for the details. Docs only.

Check: every name matches a `name:` in `server/infra/tools/`, and both anchors exist in the guide.
