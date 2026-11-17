# fix: a read re-checks containment once the file is open (#3306, reads)

## Problem

The browse and raw routes check that a path stays inside the project, then read it by name. A folder
on the path swapped for a link out in between makes the read follow it: the route answers with the
outside file's contents. Measured with the route spec below against the code before this change:
`/browse/text`, `/browse/md`, `/browse/lines` and `/api/files/raw` returned the outside text, and
`/browse/version` its hash.

#3307 closed this for writes. This is the same fix for reads.

## Change

- `server/files/verifiedRead.ts`: open with `O_RDONLY` plus `O_NOFOLLOW` where the platform has it,
  ask the check again, and read through the descriptor only when it is the file (device and inode)
  the check names now. A sync form for the routes, an async one for thumbnails. The identity check,
  `NO_FOLLOW` and the open that turns `ELOOP` into a refusal are shared with `verifiedWrite.ts`.
- `server/files/files-browse.ts`:
  - `/text`, `/version` and the rendered views (`/md`, `/json`, `/table`, `/lines`, `/code-block`,
    all through `readTextOr4xx`) read verified, against the same base their check used, and answer
    403 when the file escaped.
  - The write route reads the current file ONCE (`readOnDisk`) for its text check, its version and
    its backup. Each of those read by name before, so a swap could put an outside file's text in the
    backup store, where `GET /browse/backup` serves it under the inside file's name. `currentVersion`
    is replaced by `readOnDisk`.
- `/api/files/raw`: `sendRawFile` takes the check, opens verified, and streams from the descriptor,
  with the size taken from it. A one-file grant passes no check and is served by name as before: it
  has no root to stay inside, and `O_NOFOLLOW` would refuse a granted path that is a link.
- `/api/files/page` (an HTML file in the Files pane's Preview) is contained as the raw route is, and
  now streams from a verified descriptor the same way (`sendHtmlDocument` takes the check).
- Thumbnails read verified (async), against `realContainedWithin` on the workspace root.

## Not changed

- The limits of #3307 hold here too: three swaps each timed to the instant pass, because the
  identity is looked up by name; a hard link is the same file.
- `/browse/list` (a directory listing) and `/browse/head` (`git show` run in the file's folder): there
  is no descriptor to compare, since Node's `opendir` exposes none and git opens the folder itself.
- `/browse/search`: git reads the files from the project root itself.
- The plugin file operations (`server/backends/files/fileOps.ts`) check real containment and then
  read and write by name. That is the same gap on another surface, with a write half of its own;
  it stays in #3306.
- `/artifacts/html` checks containment only lexically, so a link under `artifacts/html` is followed
  wherever it points. That is a missing check, not a race, and is a separate defect.
- A folder made by the tree (`kind: "dir"`), rename and Trash: still open in #3306.
- A FIFO swapped in after the check blocks the open, as `readFileSync` did before.

## Verification

- `test/server/files/verifiedRead.spec.ts`: both forms read when nothing moved, read nothing after a
  swap, read nothing when the swap is undone before the re-check, refuse a last component that became
  a link, and pass three timed swaps (the limit, pinned).
- `test/server/files/verifiedRead-routes.spec.ts`: the swap happens on the route's first read-open.
  Every read route answers 403 with none of the outside text, the write route answers 403 and banks
  no backup of it, a thumbnail is not made from it. Against the code before this change the routes
  returned the outside text.
- Each decision removed in turn (the sync check, the async check, `O_NOFOLLOW`, the raw route's check,
  the write route's refusal) makes the new specs fail.
- A scratch-HOME server: text, version, the rendered views, raw with and without `Range` (bytes match),
  416, missing, folder, escapes, a project opened through a symlink, a link inside the project; save,
  conflict, create, binary refusal and the backup it banks. No descriptor is left open after them.
