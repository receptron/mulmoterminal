# fix: list and head re-check after reading; search is pinned not to follow links (#3306)

## Problem

Three reads have no descriptor the server could compare against what it checked:

- `/browse/list` lists a folder by name. Node cannot list through a descriptor.
- `/browse/head` runs `git show HEAD:./<name>` in the file's folder, and git opens that folder itself.
- `/browse/search` runs `git grep` from the project root.

A folder swapped for a link out after the check made `list` answer with the outside folder's names and
sizes, and made `head` answer with ANOTHER repository's file. With the route spec below, the code
before this change answered both with 200.

## Change

- `list` and `head` ask the containment check again once they have read. If it no longer names a
  place inside, the answer is 403 and nothing that was read is sent.
- `search` is not changed. git does not follow links in either search mode, and the project root is
  not contained in anything (any folder may be named as the base), so swapping it reaches nothing a
  request could not name directly. Measured with git 2.54.0: neither a file link nor a folder link
  out brings outside contents into the results, in a plain folder (`--no-index`) or a repository
  (`--untracked`, tracked or not). A spec pins this, for both modes.

## Not changed / what this does not hold

- A swap undone before the check is asked again is not seen, for `list` and `head`. It is pinned in
  the spec as the limit.
- Identifying the folder before reading would not see it either: renaming the folder back brings back
  the very same folder, device and inode included. This was tried and measured; the only cases it adds
  are a swap to another folder INSIDE, which is not an escape.
- `search`: git's own walk has a gap between looking at a folder and opening a file under it. That gap
  is inside git and is not reachable from this server.

## Verification

- `test/server/files/verifiedFolderReads-routes.spec.ts`:
  - `list` (swap at its `readdirSync`) and `head` (swap just before its git) answer 403 with none of
    the outside text. Against the routes before this change both answered 200.
  - With nothing moved, both answer.
  - The undone swap passes both: the documented limit.
  - `search` in a plain folder and in a repository does not return a file link or a folder link out.
- Removing the re-check from `list` or `head` makes its swap case fail.
- A scratch-HOME server: `list` of a repository root, and through a link out (403); `head` of a
  tracked file, of a missing one (`null`), and through a link out (403); `search` in a repository
  and in a plain folder, with links out in both, returning only the inside file.
