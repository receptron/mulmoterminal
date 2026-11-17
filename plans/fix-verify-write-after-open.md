# fix: a write re-checks containment once the file is open (#3306)

## Problem

The project file routes check a path (`resolveContained` / `entryUnder`) and then open it by name.
A folder on the path swapped for a link out of the project in between redirects the open, and the
write lands outside.

## Change

`server/files/verifiedWrite.ts` opens first and asks the check again:

- `writeVerified` (used by `PUT /api/files/browse/write`) opens without truncating — creating the
  file only if it is absent — and compares the open file's device and inode with the path the check
  now names. Only when they match is the file truncated and written, through the descriptor.
- `createFileVerified` (used by the tree's new-file, `POST /api/files/browse/create`) does the same
  for an exclusive create.
- A mismatch answers 403. A file the open had to create outside is removed again, by name and only
  while that name still leads to the file this call created.
- `O_NOFOLLOW` (POSIX) refuses a last component that became a link at the open itself.

Node has no `openat`, so the open can still land outside; what holds is that nothing is written there.
A swap undone before the re-check fails the comparison too, since the check then names the inside
file.

## Not changed

- Reads (`browse/text`, `browse/version`, raw, thumbnails, the backup taken before a write): the
  same gap lets them read a file outside. Left out by decision; this change is about writes.
- A new folder (`browse/create` with `kind: "dir"`): Node cannot open a folder on every platform to
  see where it landed, and what a swap could place outside is an empty folder.
- Rename and Trash: Node has no `renameat`.

## Verification

- `test/server/files/verifiedWrite.spec.ts`:
  - a swap before the open leaves an outside file untouched
  - an outside file the open created is removed
  - a swap undone before the re-check is still refused
  - a last-component link is refused
  - each part (the identity check, the clean-up, not truncating at the open, `O_NOFOLLOW`) fails a
    case when removed
- `test/server/files/verifiedWrite-routes.spec.ts` drives the real routes, swapping `docs` just
  before the open for writing. It fails if a route goes back to a plain write.
