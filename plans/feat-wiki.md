# feat: Wiki on MulmoTerminal (shared engine + shared UI via core)

> **Status (updated):**
> - **Phase 1 (pure engine → core): DONE & merged** — MulmoClaude PR #1875. `core@0.4.0`.
> - **vue-router adoption in MT: DONE** — `/wiki` routes exist (see `feat-vue-router.md`).
> - **Phase 1.5 (server read-engine → core): DONE & merged** — MulmoClaude PR #1876.
>   `core@0.5.0` (`./wiki/server` + `./wiki/paths`).
> - **MT-native read-only overlay (old Phase 2/3): SUPERSEDED — to be removed.** The
>   bespoke MT overlay (`useWikiBrowse`, `WikiBrowseOverlay`, Index/Page/Graph/Lint
>   views, `wikiImageSrc.ts`, `wiki.spec.ts`) is **abandoned** in favor of sharing
>   MulmoClaude's full wiki Vue component (decision below).
> - **New direction (Phases A–C): NOT STARTED** — extract MC's wiki UI into a shared,
>   capability-gated `@mulmoclaude/wiki-plugin/vue`; both apps render it (editable).

## User Prompt

> What does it take to provide the same Wiki feature on MulmoTerminal? We will
> obviously share the workspace.

…then: **make MT's wiki UI editable**, and **share MulmoClaude's full wiki UI** rather
than maintain a separate MT-native overlay.

## Decision (supersedes the earlier read-only / MT-native plan)

Earlier this plan built a lean **MT-native, read-only** overlay (old Phase 2/3). The
user has reversed both calls:

1. **Editable**, not read-only (save + task-checkbox toggle, at least).
2. **One shared UI**, not two — extract MulmoClaude's wiki Vue into
   `@mulmoclaude/wiki-plugin/vue` (mirroring `@mulmoclaude/collection-plugin/vue`),
   capability-gated, and render it in **both** apps.

Rationale: with MT going editable, the per-feature cost of re-implementing MC's UI in
MT compounds, and divergence between two wiki UIs over the same workspace becomes a
maintenance/UX liability. A single shared component (with host-injected seams) is the
better long-run shape — the same precedent Collections already follows.

The MT-native overlay code from old Phase 2/3 is **removed** as part of this work.

## What's already shared (reused as-is)

- **`@mulmoclaude/core/wiki`** (browser-safe pure engine) — link/slug/index-parse/lint/
  graph/route/render. The shared component imports these directly.
- **`@mulmoclaude/core/wiki/server`** (read engine) — `readWikiIndex` / `readWikiPage` /
  `loadWikiGraph` / `collectLintIssues` / `resolvePagePath` / `getPageIndex` /
  `parseFrontmatter(Tags)` / `wikiDirs`. Each host mounts a thin route over this.

## Architecture (target)

Three shared layers + per-host glue (the Collections shape, extended to the UI):

1. **Shared pure engine** — `@mulmoclaude/core/wiki` ✅ done.
2. **Shared server engine** — `@mulmoclaude/core/wiki/server`: read ✅ done; **write
   added in Phase A**.
3. **Shared Vue UI** — `@mulmoclaude/wiki-plugin/vue` (**Phase B**): the View +
   WikiPageBody + WikiGraphView + history/* components, with every host seam turned
   into an injected capability.
4. **Per-host glue** — each host mounts a thin `/api/wiki` route over the core engine
   and provides a **binding** (data fetch, save, image-URL resolution, navigation,
   locale, optional history/PDF/composer) that wires the shared component to it.
   MulmoClaude provides the full binding; MulmoTerminal provides a reduced one.

## Capability gating — the crux

MulmoClaude's `View.vue` is welded to host seams; each becomes an injected capability
so MT can supply a subset:

| MC host seam | Becomes | MC provides | MT provides |
|---|---|---|---|
| `apiPost` / `useFreshPluginData` (data fetch) | injected fetch/save | MC `/api/wiki` | MT `/api/wiki` |
| `useAppApi.navigateToWorkspacePath` / wiki-link nav | injected `navigate(target)` | real | router push |
| image-ref rewriting | injected `resolveImageSrc(ref)` | MC image resolver | MT `/api/files/raw` |
| vue-i18n (`t`) | injected `t` / label set | vue-i18n | plain strings (MT has no vue-i18n) |
| `usePdfDownload` | optional capability | provided | **omitted** (no PDF button) |
| `PageChatComposer` (spawns a chat session) | optional capability/slot | provided | **omitted** (MT has no chat sessions) |
| version history (snapshots) | optional capability | provided | **omitted initially** (deferred) |
| save / task-checkbox toggle | injected `save(slug, content)` | MC save route | MT `POST /api/wiki` |

When a capability is absent the component hides that affordance (e.g. no History tab,
no PDF button) — so MT renders an editable browse/save UI, MC keeps its full feature
set, from one component.

## Phase A — MulmoClaude: promote the write side into core (`core@0.6.0`)

Same anti-drift move as the read engine. Move `writeWikiPage` from
`server/workspace/wiki-pages/io.ts` into `@mulmoclaude/core/wiki/server` (mirrors
`collection/server`'s `writeItem`): atomic write (core gains an atomic-write helper,
precedented by `collection/server/atomic.ts`) + frontmatter stamping (`created` /
`updated` / `editor` via write-side `serializeWithFrontmatter` / `mergeFrontmatter`,
js-yaml dump). **Snapshots stay host-injected** — core `writeWikiPage` takes an optional
`onWritten`/`snapshot` hook; MC passes `appendSnapshot`, MT passes nothing. Bump
`core` → **0.6.0**, publish; bump consumers + MT to `^0.6.0`. ⚠️ `smoke` red until
0.6.0 is on npm (CLI imports the new write export).

## Phase B — Extract MC's wiki Vue into `@mulmoclaude/wiki-plugin/vue`

- New package `packages/plugins/wiki-plugin` (Vue-only, mirrors `collection-plugin`):
  move `src/plugins/wiki/{View,Preview}.vue`, `components/{WikiPageBody,WikiGraphView}`,
  `history/*`, `helpers.ts`, and consume `route.ts` from core (already there).
- Replace host imports with an injected **host binding** (a `configureWikiHost(...)` /
  provider, the pattern `collectionUi.ts` uses): data fetch/save, `navigate`,
  `resolveImageSrc`, `t`, and optional `history` / `pdf` / `composer` capabilities.
- Drop the hard vue-i18n / `useAppApi` / `PageChatComposer` / `usePdfDownload` imports;
  gate each behind the binding.
- **MulmoClaude refactor**: MC consumes the component from `@mulmoclaude/wiki-plugin/vue`
  instead of `src/plugins/wiki/`, supplying the full binding (history, PDF, composer,
  snapshots). This is surgery on a shipped app — keep behavior identical; lean on the
  existing wiki e2e/unit tests. Publish `@mulmoclaude/wiki-plugin`.

## Phase C — MulmoTerminal integration

- Add `@mulmoclaude/wiki-plugin` (+ `/vue`) to MT deps and `plugins.json`.
- **Mount a thin `/api/wiki` route** over `@mulmoclaude/core/wiki/server` (read GET +
  `POST` save from Phase A). This is the shared component's data source. (If the old
  Phase-2 `server/backends/wiki.ts` exists, repurpose it; otherwise add it.)
- **`src/composables/wikiUi.ts`** — MT's host binding (mirror `collectionUi.ts`):
  fetch/save → `/api/wiki`; `resolveImageSrc` → `/api/files/raw`; `navigate` → router
  push to `/wiki/pages/:slug`; `t` → plain strings; **omit** history/PDF/composer.
- **`WikiBrowseOverlay.vue`** — render the shared component (via `PluginFrame` / shadow
  DOM, like `CollectionsBrowseOverlay`) on the existing `/wiki` routes, opened from the
  `menu_book` toolbar button.
- **Remove** the abandoned MT-native overlay (`useWikiBrowse`, the bespoke
  `WikiBrowseOverlay` views, `wikiImageSrc.ts`, `wiki.spec.ts`) — superseded.

## Snapshots / history (still deferred)

The core writer leaves a snapshot injection point; MT passes none, so MT saves without
history and the component's History tab is hidden (capability absent). Settle the
shared-workspace **snapshot-ownership** question (who snapshots when both apps edit the
same files?) before wiring MT's.

## Out of scope

- **MT version-history / PDF / chat-composer** — MC-only capabilities the shared
  component renders only when the host provides them.
- **Snapshots in MT** — deferred (see above).

## Tests

- Core: read-engine tests ✅ + Phase A `writeWikiPage` tests (atomic write, stamping,
  injected snapshot hook fires).
- `@mulmoclaude/wiki-plugin`: component renders with a stub binding; capability-absent
  → affordance hidden (no History tab when `history` capability omitted).
- MT: `/api/wiki` route (GET + POST save round-trip, unsafe slug rejected); binding
  wiring smoke.
- MulmoClaude: existing wiki e2e/unit suites must stay green through the Phase B refactor.

## Gates

`yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn test`

## Sequence

1. ~~mulmoclaude: pure engine → core~~ ✅ (`core@0.4.0`, PR #1875).
2. ~~MT: adopt vue-router~~ ✅.
3. ~~mulmoclaude: server read-engine → core~~ ✅ (`core@0.5.0`, PR #1876).
4. **mulmoclaude: Phase A — write side → core, bump + publish `core@0.6.0`.**
5. **mulmoclaude: Phase B — extract wiki Vue → `@mulmoclaude/wiki-plugin/vue`
   (capability-gated), refactor MC to consume it, publish the plugin.**
6. **MT: Phase C — `/api/wiki` route + `wikiUi.ts` binding + `WikiBrowseOverlay`
   rendering the shared component; remove the old MT-native overlay.**

## Open decisions

- **Which MC features the shared component exposes** vs. keeps internal — confirm the
  capability list above (esp. whether MT ever wants history/PDF).
- **Create-new-pages from the UI?** MC's save route refuses creation (new pages come
  from Claude). Default: match MC.
- **Phase B sequencing risk** — refactoring MC to consume its own extracted component
  is the riskiest step; consider landing it behind the existing wiki test suite first,
  before MT consumes it.
