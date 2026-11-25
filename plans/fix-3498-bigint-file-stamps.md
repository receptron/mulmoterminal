# fix: the three file stamps take their id from bigint stats (#3498)

## Problem

#3496 / PR #3497 showed a Windows file id as a JS number is not an identity: above 2^53 its low bits
drop, and two different files can share an `ino`. Three stamps that pair `ino` with size and mtime
still read number stats, each relying on "a replacement gets a new inode":

- `server/backends/plugins/mulmoscript.ts` — the minted-media check before streaming
- `server/backends/sharedApp/manifestWrite.ts` — the "unchanged since read" check before the rename
- `server/agents/claude/own-folder-trust.ts` — the trust cache key

## Fix

`server/files/fileStamp.ts` — `fileStamp`, pure: `dev:ino:size:mtimeNs` of bigint stats. All three
use it. The time is `mtimeNs` because bigint stats carry no fraction of a millisecond; it is at least
as fine as `mtimeMs`, so a stamp can only notice a change more often. `manifestWrite` now also
includes `dev` (stricter) and takes `mode` as `Number(now.mode)` from the same single stat.

## Tests

- `test/server/files/fileStamp.spec.ts` — each field changes the stamp; two Windows ids equal as
  numbers give two stamps; a change within one millisecond is seen.
- `test/server/backends/plugins/mulmoscriptMintedMedia.spec.ts` — the media route serves a minted
  absolute movie, and refuses it once another file took the name or it was rewritten. Nothing
  exercised this path before.
- `test/server/agents/claude/own-folder-trust-marker.spec.ts` — the trust marker asks once, and again
  for a replaced or changed config file. Also untested before.
- The existing `manifestReplaceRace.spec.ts` covers the manifest refusal end to end.

A replaced file in these specs is kept alive under a second hard link: otherwise Linux hands the new
file the freed inode, and with a coarse mtime tick the stamp could legitimately match.
