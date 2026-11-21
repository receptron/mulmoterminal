# feat: the PR and issue lists show the unregistered repos a terminal is open in (#3377)

Follows #3372, which did this for the board only: `/api/prs` and `/api/issues` still read `prRepos`
alone, so a repo on the board was missing from the lists beside it.

## Server

- `withUnregisteredLists(configured, unregistered, list)` in `server/git/board-repos.ts`: lists the
  configured repos as before, then the unregistered ones, keeping only those that read without an
  error and marking them `unregistered: true`. The list function is injected, so it is pure.
- Both routes take the unregistered repos from the same place the board does:
  `unconfiguredRepos(getPrRepos(), await liveCellRepos(liveBoardCells()))` — any branch, GitHub only.
- `RepoPrs` / `RepoIssues` gain `unregistered?`.

## Client

- The board's "not registered" tag becomes `GithubUnregisteredTag.vue`, used by the board and by the
  PR and issue repo headings.
- The command palette reads the same two routes, so its PR / issue rows include those repos with no
  change of its own. Its answer is kept per set of configured repos for a few minutes, so a repo a
  terminal was just opened in shows there on the next read after that.

## Not changed

- The phone's issue list (the remote host's `issueWork` handler) still reads `prRepos` only.
- Starting work from an issue row still needs a known clone (`cwdPresets`); an unregistered repo whose
  terminal is in a directory not saved there shows its ▶ disabled, as any repo without a clone does.
