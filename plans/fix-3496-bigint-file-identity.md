# fix: compare file identity with the full 64-bit id (#3496)

## Problem

`memory-trash.spec.ts > restoreMemory > is gone ... when the Trash was emptied and its name taken by
another file` failed twice on Windows CI (daily 26.x and a PR's 24.x): `restoreMemory` answered
`restored`, which it does only when the file now in the Trash has the `{ dev, ino }` recorded at
trash time. That record, and the comparison, used `lstat` WITHOUT `bigint`.

## What the probes established (GitHub Actions, windows-latest)

- A Windows file id is `sequence << 48 | record`; for ~99% of files it is above 2^53, where a JS
  number drops the low bits.
- In a folder churned the way a test suite churns one, 2,000 live files collapsed into fewer
  distinct NUMBER ids: two DIFFERENT files reported the same `ino` (124 groups on Node 24, 88 on 26;
  0 as bigint). Same sequence, neighbouring records.
- Deleting and recreating at one name normally reuses the record with sequence + 1 (2^48 apart, no
  collision) — which is why the spec passes almost always. Under a full suite another worker can take
  the freed record, the new file lands on a neighbour, and the numbers can collide.
- The original failure itself did not reproduce in the probes (it is rare); the mechanism did.

## Fix

`server/files/fileIdentity.ts` — `isSameIdentity` over bigint `{ dev, ino }`, pure. Every place
that decided identity from `dev` + `ino` alone goes through it with `bigint` stats:

- `memory-trash.ts`: the identity recorded at trash time, the restore's check, `unlinkIfSame`
- `memory-folders.ts`: `isTheIndex`, `openRegularFile` (its `mtimeMs` now comes from a number stat
  of the handle, after the identity check — the same file; bigint stats carry only whole ms)
- `file-history-read.ts`: the open-check in `readBoundedText`
- `tree-ops.ts`: `holds` (already bigint) and the case-only rename check (was number)
- `verifiedWrite.ts`: `isOpenedFileAt` (already bigint)

## Left as is

Stamps that combine `ino` with size and mtime (`manifestWrite.ts`, `mulmoscript.ts`,
`own-folder-trust.ts`): a false match needs all three to agree.

## Tests

`test/server/files/fileIdentity.spec.ts` — the measured shape (one sequence, neighbouring records)
is one value as numbers and two files as bigint. The `isSameFile` case moved there from
`library-memory-routes.spec.ts`.
