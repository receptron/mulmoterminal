# feat: support collection registry import (Discover tab)

Issue: receptron/mulmoterminal#156
Upstream: receptron/mulmoclaude#1865 / PR #1866 (engine extracted to `@mulmoclaude/core@0.2.16`)

## Problem

The collection plugin's **Discover / registry** tab is reachable in MulmoTerminal, but
its host bindings `listRegistry` / `importRegistry` are stubbed to return
`501 "not supported in MulmoTerminal yet"` (`src/composables/collectionUi.ts`), because
the registry engine used to live only in the MulmoClaude app.

It now ships in `@mulmoclaude/core`:
- `@mulmoclaude/core/collection/registry/server` — `listRegistry()`,
  `importRegistry(author, slug, workspaceRoot, registry?)`
- `@mulmoclaude/core/collection/registry` — `RegistryListResponse`, `RegistryImportResponse`

## Approach

Thin host glue, mirroring the upstream app route (`server/api/routes/collectionsRegistry.ts`)
and MulmoTerminal's existing read-side collection wiring.

### 1. Bump `@mulmoclaude/core` → `^0.2.16`

`yarn add @mulmoclaude/core@^0.2.16`.

### 2. `server/backends/collections.ts`

- `configureCollectionHost` `paths`: add the now-required
  `collectionsRegistriesConfig: (root) => path.join(root, "config", "collections-registries.json")`.
- Capture the workspace root at `initCollectionsBackend` (module-scoped) so the import
  route can pass it to `importRegistry` (the engine needs it explicitly; the read route
  needs nothing).
- In `mountCollectionRoutes`, before the `:slug` routes, add:
  - `GET  /api/collections/registry/list`   → `res.json(await listRegistry())`
  - `POST /api/collections/registry/import`  → validate `author`/`slug`, call
    `importRegistry(author, slug, workspace, registry)`, pass `{ok:false,status,error}`
    straight through as the HTTP status, else return `result.response`.

Route paths sit under the existing `/api/collections/*` namespace; the 3-segment
`.../registry/list` and `.../registry/import` don't collide with the `:slug` routes
(those all carry a different suffix), and they're registered first to be safe.

### 3. `src/composables/collectionUi.ts`

- import `RegistryListResponse`, `RegistryImportResponse` from `@mulmoclaude/core/collection/registry`.
- replace the two stubs:
  - `listRegistry: () => apiGet<RegistryListResponse>("/api/collections/registry/list")`
  - `importRegistry: (author, slug, registry) => apiSend<RegistryImportResponse>("POST", "/api/collections/registry/import", { author, slug, registry })`

## Tests

- `server/backends/collections.spec.ts` (or a new spec): mock
  `@mulmoclaude/core/collection/registry/server` (`vi.mock`) so no network — assert
  the list route returns the engine payload and the import route maps success +
  passes through `{status,error}` on failure, and validates missing author/slug → 400.

## Docs

- README: drop the registry "not supported" line; note the two routes and the optional
  `config/collections-registries.json` (absent → official registry only).

## Out of scope

- Registry **export/contribute** (`performExport`) — follow-up.
