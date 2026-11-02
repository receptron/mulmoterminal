# fix: list a linked folder as a folder in Files (#3235)

## Problem

`listEntries` (`server/files/files-browse.ts`) took "is a folder" from `Dirent.isDirectory()`, which
describes the entry itself. A symlink or a Windows junction to a folder therefore listed as a file
(with the size of the folder it leads to), could not be opened as a folder, and `/text` refused it
as a directory. Reproduced on macOS with a symlink.

## Fix

`server/files/browseEntry.ts` (pure): `browseEntryOf(name, direntIsDirectory, followed)`. A
directory entry is a folder; anything else asks the stat that follows links (the one `listEntries`
already took for the size). A folder at the other end makes it a folder; a stat that cannot be had
(a broken link) leaves a file of size 0, as before.

Containment is unchanged: entering a link that leads outside the project is still refused with 403
by `resolveContained`'s realpath check. The listing now shows such a link as a folder, which is the
same shape `dir-suggest-route.ts` already gives.

## Left alone, on purpose

- `project-files.ts` (the finder's walk) and `remoteHost/mobileFileWalk.ts` (the phone's walk) do not
  descend links. Both are recursive walks, where following a link risks a cycle and leaving the
  project; both say so in their own comments.

## Tests

- `test/server/files/browseEntry.spec.ts`: the rule, both directions.
- `test/server/files/linkedFolders.spec.ts`: a real listing with a folder link and a
  broken link (made as `junction`, so Windows CI makes a real junction), and the list route entering
  a linked folder inside the project and refusing one leading outside.
