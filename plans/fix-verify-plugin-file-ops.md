# fix: the plugin file operations survive a path swapped after the check (#3306)

## Problem

`createFileOps` (`server/backends/files/fileOps.ts`) is the rooted `FileOps` handed to plugins: the
shared artifacts area, each plugin's data and config folders, and the MulmoScript stories root. It
checks a path lexically and then through `realpath`, and then reads or writes it by name. A folder on
the path swapped for a link out in between carries the operation out of the root. With the swap spec
below, the code before this change returned the outside file from `read` and `readBytes`, and `write`
wrote into the outside folder.

## Change

- `read` / `readBytes` go through `openVerifiedWithinScope` from `@mulmoclaude/core/files`. The handle
  is proven, after opening, to be the file the root holds now, and the bytes are read through it.
  Missing, outside, or swapped during the call all throw with `code: "ENOENT"`, as a missing file did.
- `write` goes through `writeFileVerifiedInScope`. It writes a staging file in the target's folder,
  verifies the staging file sits inside the root, and only then renames it into place.
- The write goes to the REAL place the existing check resolved, so a link inside the root is written
  through (its target replaced or created) rather than replaced itself, as before.
- This is what MulmoClaude's `server/plugins/confined-file-ops.ts` does with the same primitives, so
  the two hosts give plugins the same guarantee.

The anchor is the root's own realpath, taken per operation. A ROOT that is itself replaced by a link
is not caught, as before: `createFileOps` is given only the root, not a trusted folder above it.

## Behaviour that changes

- A write replaces the file instead of writing into it: a hard link to it no longer sees the new
  contents, and the file takes the default mode for a new file rather than keeping the old one.
- A failed write leaves the old contents whole (it never truncates first).

## Not changed

- `stat`, `exists`, `readDir`, `unlink` stay check-then-act, as in MulmoClaude: none returns or writes
  file contents.
- The core primitives' own limits (`plans/fix-3573-verified-open.md` in MulmoClaude): Node has no
  `openat` or `renameat`, so a parent swapped between the staging file's check and the rename can
  still carry the rename into a folder the actor could already write.
- The parent folders a write creates are made by name before the check is asked again. A swap before
  that `mkdir` can leave EMPTY folders outside; the check then refuses and nothing is written there.
  Node has no `mkdirat` either; this is the same gap as the tree's new folder, still open in #3306.

## Verification

- `test/server/backends/files/fileOps-swap.spec.ts`: the swap happens at the first open, read or
  write after the check. `read` and `readBytes` throw ENOENT, `write` fails and the outside folder is
  untouched; with nothing moved, reads and writes (into a new folder too) work. Against the code
  before this change the three swap cases fail: the outside contents came back and the write landed.
- `test/server/backends/files/fileOps.spec.ts` passes unchanged, including writing through a dangling
  link whose target is inside.
- A scratch-HOME server: `presentHtml` `loadHtml` / `saveHtml` on an artifact, a save into a new
  folder, both refused through a link out of the root, and no staging file left behind.
