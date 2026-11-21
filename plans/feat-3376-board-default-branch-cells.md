# feat: the board shows terminals on the default branch or on no branch (#3376)

A terminal on `main`, or with HEAD detached, belonged to no card and so was not on the board at all,
which read as the board missing directories.

## Server

- `placeOf` places a detached HEAD on no branch (`branch: null`); a directory with no HEAD at all
  (`currentBranch` answering neither a branch nor detached) is still not placed.
- `mainlineCells` (`server/git/board.ts`, pure): the cells on no branch or on the default branch.
  With the default branch unknown only the first, since a cell on any branch then gets a branch card
  as before. `buildRepoBoard` gives a cell on no branch no card.
- `RepoBoard.mainlineCells`, present only when there is one. An unregistered repo (#3372) whose only
  terminal is on its default branch is read and shown the same way.

## Client

- A row above the columns, one box per branch (the default branch first, "no branch" last,
  `mainlineGroups`), each listing its cells with the card's own cell component.
- With "only work with an open terminal" on, a repo with only such cells still shows. Shown with the
  switch off too: it is live information, not a card.
- The live feed (#3182) and the instant close (#3363) cover these cells as they do a card's.
