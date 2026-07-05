# fix #210 — collection actions send seed prompt without `<collection_paths>`

## Problem

Collection action buttons (e.g. jma-weather の「初期設定」/「使い方」) send the seed
prompt to chat, but the skill can't run: the two action routes in
`server/backends/collections.ts` call the shared seed builders **without the optional
`paths` argument**, so the prompt lacks the `<collection_paths>` block. The skill
template needs `skillDir` / `dataPath` from that block to locate its files.

- item-level route (`POST /api/collections/:slug/items/:itemId/actions/:actionId`)
- collection-level route (`POST /api/collections/:slug/actions/:actionId`)

## Fix (MT-only, no package bump)

`@mulmoclaude/core/collection/server` already exports `promptPathsFor(collection,
workspaceRoot)` and `getWorkspaceRoot()` (dep is `@mulmoclaude/core@^0.8.2`), and MT
already calls `configureCollectionHost({ workspaceRoot })` at init so `getWorkspaceRoot()`
resolves. Pass `promptPathsFor(collection, getWorkspaceRoot())` as the last arg to both
builders. Mirrors MulmoClaude's `server/api/routes/collections.ts`.

## Verification

- `yarn format/lint/typecheck/typecheck:server/build/test` — all green (634 tests).
- Ran the server and `POST /api/collections/jma-weather/actions/setup`: response prompt
  now contains the `<collection_paths>` block (`slug` / `dataPath` / `skillDir`).
