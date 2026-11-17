# fix: a folder made after a containment check is checked once made (#3306)

## Problem

Two places make folders after checking that the path stays inside the root, and act by name in between:

- the Files tree's new folder (`createEntry(…, "dir")` in `server/files/tree-ops.ts`), and
- the parent folders a plugin write creates (`createFileOps`'s `write` in
  `server/backends/files/fileOps.ts`, a `mkdir -p` on the lexical path).

An ancestor swapped for a link out before the `mkdir` makes it land outside. The tree route then
answered 200 for a folder it had made outside; the plugin write made the whole missing chain outside
before its own re-check refused the file.

## Change

`server/files/verifiedMkdir.ts`:

- `makeFolderVerified(abs, recheck)` makes one folder, then asks the check again. If what the check
  names now is not a folder inside, the answer is "escaped". A name that is already there throws
  EEXIST, as `mkdir` does.
- `makeFoldersVerified(dir, contained)` makes the missing levels top first. A level is made only
  while the check still names its parent as a folder inside, and is checked once made. It stops at
  the first level that did not land inside, so nothing deeper is made. Existing levels are only
  checked; a level another creator made meanwhile (EEXIST) counts once it too passes the check.

Then:

- The tree's new folder uses `makeFolderVerified`; an escape is the route's 403.
- The plugin write makes its root as before, then the levels below it with `makeFoldersVerified`
  against `realContainedWithin(root, …)`; an escape throws before anything is written.

## Not changed / what this does not hold

Node has no `mkdirat`, and no portable way to open a folder and ask where it landed. So:

- a level made outside is left there, EMPTY: removing it by name would be another check-then-act;
- a swap undone before the re-check passes it (pinned in the spec as the limit).

What this does hold: at most one empty folder outside per call, and no content written there.

## Verification

- `test/server/files/verifiedMkdir.spec.ts` covers:
  - one folder and a chain when nothing moved;
  - a swap at the first `mkdir`, which reports "escaped", leaves one empty folder outside, and makes
    nothing deeper;
  - an existing level that already leads out, under which nothing is made;
  - a level made by another creator between the look and the make;
  - the undone swap, pinned as the limit;
  - EEXIST.
- `test/server/files/verifiedWrite-routes.spec.ts`:
  - `/browse/create` of a folder with the swap answers 403, and what is left outside is an empty
    folder;
  - against the code before this change it answered 200.
- `test/server/backends/files/fileOps-swap.spec.ts`:
  - a plugin write whose first `mkdir` meets the swap is refused, and leaves only one empty folder
    outside;
  - replacing the verified chain with a plain recursive `mkdir` makes it fail (the deeper folder
    appears outside).
- Removing the re-check after `mkdir` makes the single-folder and route cases fail.
