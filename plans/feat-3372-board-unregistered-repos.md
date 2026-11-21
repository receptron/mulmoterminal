# feat: the board shows a repo with an open terminal even when it is not registered (#3372)

Follows #3359 / #3363: the board read only `prRepos`, so a terminal open in a clone of any other
repo was placed on no card and dropped.

## Server

- `placeCells` already resolves each cell's directory to a repo and branch. It now also reports
  which of those repos are on GitHub, by `owner/repo`.
- `unconfiguredRepos` (`server/git/board-repos.ts`, pure): those repos minus the configured ones,
  matched by `repoIdentity` so `O/R`, `o/r` and `github.com/o/r` are one repo; each once, by name.
- `boardAcrossRepos` reads them after the configured ones and marks each `unregistered: true`. One
  that fails to read is dropped without an error row: the user never asked for it.
- The detail route accepts a repo a live cell is in as well as a configured one. Both come from the
  server's own state, so a request still cannot name a repo of its choosing.

## Client

- Switch on: unchanged rule (`openWorkOnly`), so an unregistered repo shows while it carries a cell
  and leaves with its last cell, at once on close (#3363).
- Switch off ("show everything"): unchanged, the registered repos only (`registeredOnly`).
- An unregistered repo's heading carries a small "not registered" tag.

## Out of scope

- `/prs` and `/issues` still list the registered repos only.
