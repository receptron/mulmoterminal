# fix: the Files tree follows a file the host opened while the pane was starting (#3557)

## Problem

A path clicked in terminal output while the Files pane is closed opens the pane and the file
together. The file comes to the front while `start()` is still listing the root, and the
`frontPath` watch ignores it because following has not started yet. When `start()` reaches
`followFrontTab`, it only scrolls to the front row (#3058). It does not open the row's folders,
so the row is missing and the tree stays collapsed.

## Fix

- `FilesPane.vue` counts opens that come from the host. Both exposed entry points are wrapped:
  `openFile` and `showFile`. `showFile` without a line calls `tabs.open` directly, so wrapping only
  `openFromTerminal` would miss it.
- `start()` reads the count before its first await and passes
  `followFrontTab(startedAt, hostOpens !== hostOpensAtStart)`.
- `useFilesReveal`'s `followsFrontTab.start` calls `showInTree` when the host opened a file, and
  keeps `scrollToRow` otherwise. A folder the reader closed in the remembered tree stays closed.

The read generation is not used for this: the restore's own open bumps it too (as the issue notes).

## Tests

- `filesPaneFollowTab.spec.ts`: the root listing is held, then `openFile` or `showFile` is called
  right after mount. Once the root is released, the tree shows the file's folders and its row.
- `useFilesReveal.spec.ts`: `followFrontTab(epoch, true)` opens the folders outermost first and
  scrolls to the row.

All three fail without the fix.
