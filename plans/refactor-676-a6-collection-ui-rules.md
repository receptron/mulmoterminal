# refactor: extract collectionUi.ts pure decisions into collectionUiRules.ts (#676 A6)

Date: 2026-07-23

## Goal

Part of #676 (audit of source for pure functions that can be extracted and tested).
Priority-A item A6: pull three pure decisions out of `src/composables/collectionUi.ts`
into a sibling `src/composables/collectionUiRules.ts` so they can be unit-tested without
the fetch/DOM host around them. Behavior-preserving (1:1 move).

## Extracted functions

- `htmlPreviewUrl(value: string): string | null`
  - Returns the sandbox preview route URL only when `value` is an `artifacts/html/*.html`
    path; otherwise `null` (caller falls back to the raw-download URL).
  - **Deliberate pre-existing asymmetry preserved**: the `.html` suffix is matched
    case-insensitively (`toLowerCase().endsWith(".html")`) but the `artifacts/html/`
    directory prefix is matched case-sensitively (`startsWith`). Kept as-is; pinned by a
    test annotated as intentional existing behavior.
  - Per-segment `encodeURIComponent` URL assembly reproduced exactly.
- `remoteViewItemsQuery(req: { offset?: number; limit?: number; fields?: string[] }): string`
  - Builds the `?offset=…&limit=…&fields=…` suffix (or `""`).
  - `offset` guarded with `!= null` (NOT truthy) so `offset:0` is kept; empty `fields`
    array is dropped.
- `deleteErrorMessage(body: unknown, status: number): string`
  - Server `{ error: string }` body when present, else `HTTP <status>`. Uses `isObject`
    from `graphai` as the type guard (no `as` casts).

`collectionUi.ts` keeps all fetch/DOM/`configureCollectionUi` wiring and now calls these.

## Tests

`test/src/composables/collectionUiRules.spec.ts` (vitest):

- htmlPreviewUrl: happy path + per-segment encoding; uppercase `.HTML` extension passes
  (case-insensitive suffix); uppercase `Artifacts/HTML/` prefix falls back to null
  (case-sensitive prefix — pinned as intentional); non-html; wrong directory; empty rest;
  empty string.
- remoteViewItemsQuery: `offset:0` included; non-zero offset; offset omitted; limit
  (incl. `limit:0`); empty `fields` dropped; populated `fields`; all three combined;
  all omitted → `""`.
- deleteErrorMessage: error string returned; non-string error → `HTTP <status>`; missing
  error field → `HTTP <status>`; null body → `HTTP <status>`; non-object body →
  `HTTP <status>`.

## Mutation check

Changed `if (req.offset != null)` → `if (req.offset)` (truthy). The `offset:0` pin tests
(`includes offset when it is 0`, `combines all three params`) turned red (2 failed);
reverted and all 21 pass again.

## Verification

- `prettier --write` + `eslint` on changed/new files: clean.
- `vitest run test/src/composables/collectionUiRules.spec.ts`: 21 passed.
- `yarn typecheck` (vue-tsc -b): pass.
- `yarn typecheck:server` (tsc -p tsconfig.server.json): pass.
- `yarn typecheck:test` (vue-tsc -p tsconfig.test.json --noEmit && tsc -p tsconfig.test-server.json): pass.
