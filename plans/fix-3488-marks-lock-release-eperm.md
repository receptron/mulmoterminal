# fix: a transient EPERM no longer drops the marks lock's release (#3488)

## Problem

`removeIfOwnedBy` (`server/backends/library/library-marks.ts`) moves the lock aside before checking
its owner, and treated ANY failure of that rename as "already gone or replaced". On Windows the
rename answers `EPERM` for a moment while another process has the lock's `owner` file open — which a
waiting holder does between its attempts (`staleOwnerOf`). The release was dropped, the lock stood
until `MARKS_LOCK_STALE_MS`, and the waiter gave up first (`... is held by another process`).

## Fix

- `moveAside` retries the rename while the error is busy (`EPERM` / `EBUSY` / `EACCES`), at
  `MARKS_LOCK_RETRY_MS`, up to `MARKS_LOCK_MOVE_ATTEMPTS`. Every other failure still means "gone or
  replaced" and returns at once.
- Both callers benefit: the holder's own release and the stale takeover, which hits the same busy
  answer when the dead holder's lock is being read by a third waiter.
- A lock that stays busy past the bound is left as before (no throw from a `finally`); it is then
  reclaimed by the stale path, as it was.

## Tests

`test/server/backends/library/library-marks.spec.ts`:

- `fs.rename` stubbed to refuse twice with each busy code: the lock is gone afterwards. Fails on the
  old code.
- A non-busy failure (`ENOENT`) is not retried: one rename call.

Not reproduced locally (macOS): the Windows race itself. The reporter's cross-process spec passing
on Windows is the external check.
