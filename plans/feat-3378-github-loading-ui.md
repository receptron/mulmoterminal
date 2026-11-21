# feat: the GitHub board and lists show that they are loading (#3378)

Each read is several `gh` calls per repo, and #3372 added repos to the board, so a first read takes
seconds. Until now the only sign was a small word in the header, over an empty page.

- `GithubLoading.vue`: a spinning `progress_activity` and the loading line, with `role="status"`,
  shown where the content goes until the FIRST read answers (`loaded`), successful or not.
- A read while content is on screen keeps it there: the refresh button's icon spins and the button
  carries `aria-busy`. The header's loading word is gone; the spinning button replaces it.
- Both the board (`GithubBoard.vue`) and the PR / issue list (`GithubPane.vue`). The pane's
  hard-coded `Loading…` goes with it; the line comes from `githubBoard.loading`, in five languages.
