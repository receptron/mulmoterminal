# refactor: extract `stagedStorageIds` (#676 A2)

Part of #676 — pull the decision rule out of I/O so it can be pinned with tests.

## What

`server/backends/remoteHost/onExpire.ts` holds a non-exported `stagedStorageIds(params)` plus the
traversal guard `STORAGE_ID_RE = /^[A-Za-z0-9-]+$/`. When the shared runner drops an expired
command, `onExpire` reads each `params.attachments[].storage_id` and hands it straight to
`deleteObject(users/{uid}/uploads/{storageId})`. The regex is the only thing standing between a
malformed id and a reshaped Storage path (no `/`, no `..`).

This is the **lenient** copy of a rule that exists in three places: the strict version
(`handlers.spec`) and the ingest version (`ingestAttachments.spec`, which pins `../evil` / `a/b`
rejection) are both tested. This copy — cleanup, so malformed entries are skipped rather than
thrown — was the only one non-exported and untested.

## Change

- New pure file `server/backends/remoteHost/stagedStorageIds.ts` exporting `stagedStorageIds` and
  `STORAGE_ID_RE`. Kept separate from `onExpire.ts` so the pure rule never pulls in `firebase`.
- `onExpire.ts` imports from it. **Behavior unchanged** — the function body is moved verbatim.
- Colocated `stagedStorageIds.spec.ts` (sibling to `ingestAttachments.spec.ts`).

`JsonObject` comes from `@mulmoclaude/core/remote-host`.

## Tests

Order-preserving extraction of valid ids; `../evil` and `a/b` rejected; non-array `attachments`
⇒ `[]`; null / array / `storage_id`-less entries skipped without throwing; non-string
`storage_id` excluded; empty attachments ⇒ `[]`.

## Mutation check

- Loosen `STORAGE_ID_RE` to `/^.+$/` → the traversal-guard test goes red (returns `../evil`,
  `a/b`).
- Drop the `typeof rawId === "string" && STORAGE_ID_RE.test(rawId)` filter → both the
  traversal-guard and non-string-exclusion tests go red.

Reverted both; suite green.

## Verification

`prettier` + `eslint` on the touched files; `yarn typecheck`, `yarn typecheck:server`,
`yarn typecheck:test` all clean; `vitest run server/backends/remoteHost` green.
