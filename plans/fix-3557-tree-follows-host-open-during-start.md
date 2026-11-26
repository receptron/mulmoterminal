# fix: the Files tree follows a file the host opened while the pane was starting (#3557)

## Problem

A path clicked in terminal output while the Files pane is closed opens the pane and the file
together. The file comes to the front while `start()` is still listing the root, and the
`frontPath` watch ignores it because following has not started yet. When `start()` reaches
`followFrontTab`, it only scrolls to the front row (#3058). It does not open the row's folders,
so the row is missing and the tree stays collapsed.

## Fix

- `FilesPane.vue` records the path the host last asked for (`hostOpenedPath`). Three routes set it:
  the exposed `openFile`, the exposed `showFile`, and the `requestedPath` watch. `start()` clears it
  before its first await and passes it to `followFrontTab`.
- `useFilesReveal`'s `followsFrontTab.start` calls `showInTree` when the tab in front IS that path,
  and keeps `scrollToRow` otherwise.

A path, not a count of host opens: an open still in flight, or one that was declined or failed,
leaves the remembered tab in front, and a folder the reader closed must stay closed. An open that
lands later is picked up by the `frontPath` watch, which is following by then.

The read generation is not used for this: the restore's own open bumps it too (as the issue notes).

## Tests

- `filesPaneFollowTab.spec.ts`: the root listing is held, then `openFile`, `showFile` or a new
  `requestedPath` arrives right after mount. Once the root is released, the tree shows the file's folders and its row.
- `useFilesReveal.spec.ts`: `followFrontTab(epoch, path)` with that path in front opens the folders outermost first and
  scrolls to the row. With a different path in front it only scrolls.
