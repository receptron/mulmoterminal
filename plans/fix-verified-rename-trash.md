# fix: a rename or a move to the Trash reports a move that acted outside (#3306)

## Problem

The Files tree's rename and Trash (`server/files/tree-ops.ts`, routes in `files-tree-routes.ts`) check
the entry's parent through links, then `rename` by name. A folder above the entry swapped for a link
out in between makes the rename act on the OUTSIDE entry of the same name — renaming it in its folder,
or moving it into the user's Trash — and the route answered 200. Reproduced with the route spec below
against the code before this change.

## Change

Node has no `renameat`, so the move cannot be stopped beforehand. It is detected instead:

- The entry is identified (device and inode, `lstat`) just before the `rename`.
- Afterwards the check is asked again. For a rename it is the check for the NEW name, and it must name
  a place holding that same entry. For the Trash, the entry's own check must still name a place
  inside, and what reached the Trash must be that same entry.
- Otherwise the outcome is "escaped", and the route answers 403.

A swap undone right after the move is caught too, because the identity was taken from the inside entry.

## Not changed / what this does not hold

- A move that acted outside is reported, NOT undone. Putting it back by name would be another
  check-then-act. For the Trash, the outside entry sits in the user's Trash, where it can be restored.
- A swap made before the entry is identified and undone before the check is asked again passes.
- The window itself is not narrowed: the route was already synchronous from the check to the rename.

## Verification

`test/server/files/verifiedMove-routes.spec.ts` swaps `docs` for a link out at the `rename`. With the
swap:

- rename answers 403, and the outside entry was the one renamed;
- the Trash answers 403, and the outside entry was the one moved;
- both answer 403 when the swap is undone right after the move;
- the Trash answers 403 when the swap came before the entry was identified.

With nothing moved, both work. Against the code before this change, every swap case answered 200.

Removing each decision in turn makes a case fail: the check after a rename, the identity for a
rename, the re-check for the Trash, and the identity for the Trash.

`tree-ops.spec.ts` passes with the checks supplied.

A scratch-HOME server: rename, rename onto an existing name (409), Trash into the scratch `~/.Trash`,
Trash of a missing entry (404).
