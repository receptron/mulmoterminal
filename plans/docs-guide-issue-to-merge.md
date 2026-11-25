# docs #3475: one guide page for handing issues to agents, and the 13.8.0 release

## Why

Taking an issue to merge with agents (13.7.0) is one of the headline features, but how to use it is
spread over two sections of `config.md`, three skills and the 13.7.0 setup guide. Nobody new can read
it in one place.

## What

- `docs/guide/{en,ja}/issue-to-merge.md` (`nav_order: 5.5`, after Worktrees): what happens (the three
  roles), setup (`review` key, a workspace cell, `gh`, `maxIssueSessions`), one issue, several issues,
  what you will see (lines typed in, the GitHub board, the PR), when you are needed, codex's sandbox
  grants, cleanup, troubleshooting, and the tools for reference.
- Links to it from both indexes, the two skill rows in `features.md`, and the `review` /
  `maxIssueSessions` sections of `config.md`.
- Screenshots from the live app, of the demo sessions only (a separate browser, its grid-layout copy
  to the server blocked so the maintainer's backup is not overwritten). Paths shown are confirmed
  before they are committed.
- Release 13.8.0: ChangeLog, `v13.8.0` setup guide in both languages, `facts.json`, `feature-list.md`,
  the index banner.

## Checks

- Every link and anchor in the new pages resolves (a link checker over the Markdown).
- The config samples pass the real validators (`reviewSchema`, `sanitizeMaxIssueSessions`).
- `test/docs` passes.
