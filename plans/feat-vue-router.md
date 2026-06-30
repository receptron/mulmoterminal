# feat: adopt vue-router — unique URLs for top-level navigation

## User Prompt

> I think it makes sense to add vue-router to MT as well, giving a unique URL to
> each top-level place to navigate to, such as chat, terminals, collections +
> collection pages, and (eventually) wiki and wiki pages — but not individual
> chat sessions like MulmoClaude.

Locked decisions (from the design discussion):

1. **Records are NOT addressable** — an open collection record stays a non-history
   modal (today's behavior). Only collection *pages* (slug) get a URL.
2. **Path naming** — `/terminals` for the grid, `/` for chat (the single view).
3. **Settings stays a modal** (no `/settings` route).
4. **History mode** (clean URLs, not hash) — chosen because this is an app-wide
   nav system, not a wiki-only bolt-on.

## Background / motivation

MT today has **no router**. Top-level navigation is hand-rolled reactive state +
`localStorage`, and the code already admits it's a router stand-in:

- `src/App.vue` — `viewMode: "single" | "grid"` ref (persisted to
  `localStorage("view_mode")`) plus full-screen overlays (`CollectionsBrowseOverlay`,
  `AccountingOverlay`) toggled by composables.
- `src/composables/useCollectionBrowse.ts` documents itself as *"the no-router
  replacement for MulmoClaude's /collections + /collections/:slug routes"* and
  already carries `routeSlug` / `routeSelectedId` / `browseNavigateToRecord`.
- `src/components/AppToolbar.vue` already treats the surfaces as mutually-exclusive
  "places" (`chatActive`, grid, `collectionsActive`, `collectionDetail`, feeds,
  `accountingActive`).

So this is **promoting the existing ad-hoc state stores to real routes**, not
inventing a navigation model. The migration is contained because the `browse*`
mutators/readers and the `viewMode` setters are already centralized — we
reimplement their bodies on the router and the call sites come along unchanged.

**Downstream payoff:** the eventual Wiki port (see end) reuses MulmoClaude's wiki
Vue component, which is built on vue-router (`route.ts` + `guards.ts`). With a
router in place those reuse verbatim; without one we'd have to abstract vue-router
out of the shared component. Landing this PR first makes the wiki port cheaper.

## Route table

| Path | name | Surface | Backing state today |
|---|---|---|---|
| `/` | `chat` | single view (Terminal + GuiPanel, no overlay) | `viewMode="single"` |
| `/terminals` | `terminals` | multi-terminal grid (`GridView`) | `viewMode="grid"` |
| `/collections` | `collections` | collections index overlay | `browseGotoIndex("collection")` |
| `/collections/:slug` | `collectionDetail` | a collection page | `browseGotoDetail("collection", slug)` |
| `/feeds` | `feeds` | feeds index overlay | `browseGotoIndex("feed")` |
| `/feeds/:slug` | `feedDetail` | a feed page | `browseGotoDetail("feed", slug)` |
| `/accounting` | `accounting` | accounting overlay | `accountingViewOpen()` |
| `/wiki` *(future)* | `wiki` | wiki index | — |
| `/wiki/:section(pages\|log\|lint-report\|graph)?/:slug?` *(future)* | `wiki` | wiki page / log / lint / graph | — |

NOT routed (intentional):

- **Active session / terminal** (`activeId`) — transient in-place state within `/`
  and `/terminals`. Sessions are not addressable (per the user's rule).
- **Collection records** (`selectedId`) — stay a non-history modal (decision 1).
- **Settings** — modal over any route (decision 3).

## Design

### 1. Router setup

- New `src/router/index.ts`: `createRouter({ history: createWebHistory(), routes })`.
  Routes use a trivial `Stub` component (an empty render) — App.vue renders by
  `route.name`, **not** via `<router-view>` (mirrors MulmoClaude's `Stub` +
  switch-on-`route.name` pattern, so MT's 3-pane shell and overlays stay put).
- Export the **router singleton** from this module so module-level code
  (`useCollectionBrowse`, `collectionUi`) can call `router.push(...)` /
  `router.currentRoute.value` without component context.
- A catch-all `{ path: "/:pathMatch(.*)*", redirect: "/" }` so unknown URLs land on
  chat.
- `src/main.ts`: `createApp(App).use(router).mount("#app")` (add `.use(router)`).

### 2. History mode → server SPA fallback (**Phase 1 — landed separately**)

History mode means a hard reload / deep-link of `/terminals` or `/collections/foo`
must serve `dist/index.html`. Add a fallback in `server/index.ts`, mounted **after**
`express.static(...)` (currently line ~810) so real asset files win, and guarded so
it never shadows any server endpoint.

**Single reserved prefix.** Rather than maintain an exclusion list, reserve only
`/api` and route everything server-side under it. Two facts make this clean:

- **WebSockets are irrelevant to the Express fallback.** `/ws`, `/ws/run`, and
  `/ws/pubsub` are all dispatched by `server.on("upgrade")` (server/index.ts:~1215),
  which intercepts upgrade requests *before* Express routing. The catch-all `app.get`
  can never shadow them.
- **Only one HTTP route lives outside `/api`:** the GUI MCP endpoint
  `/mcp/:sessionId`. Phase 1 relocates it under the prefix → `/api/mcp/:sessionId`
  (route trio POST/GET/DELETE + the `mcpConfigJson` URL at ~line 556). Everything
  else is already `/api/*`, and `assets/` is served by `express.static` mounted
  before the fallback (real files win).

The fallback then collapses to a single prefix guard:

```ts
// SPA fallback: serve index.html for any non-/api path (history-mode deep links).
// WS upgrades bypass Express; static assets are served above; all server HTTP
// endpoints live under /api — so /api is the only reserve needed.
app.get(/^\/(?!api\/).*/, (_req, res) =>
  res.sendFile(path.join(__dirname, "../dist/index.html")));
```

- Express 5 / path-to-regexp v8 gotcha: `app.get("*")` is invalid — use the regex
  above (or an equivalent prefix-guard middleware).

**Phase 1 = the `/mcp` → `/api/mcp` relocation only** (no router yet). It is a safe,
self-contained refactor that makes the eventual fallback trivial; landed as its own
PR ahead of the router work.

### 3. App.vue — derive surfaces from the route

Replace the `viewMode` ref + `localStorage` with route-derived computeds:

- `const route = useRoute()`
- `const isGrid = computed(() => route.name === "terminals")` →
  `<GridView v-if="isGrid" @exit="router.push('/')">` else the single shell.
- Overlay visibility derived from `route.name`:
  - collections overlay open when `route.name ∈ {collections, collectionDetail, feeds, feedDetail}`
  - accounting overlay open when `route.name === "accounting"`
  - chat (no overlay) when `route.name === "chat"`
- Delete the `localStorage("view_mode")` read/write and the `viewMode` watch.

### 4. The `browse*` / `viewMode` seam (reimplement on the router)

`src/composables/useCollectionBrowse.ts` — keep the exported function names; swap
the bodies to drive the router (import the router singleton):

- `browseGotoIndex(kind)` → `router.push(kind === "feed" ? "/feeds" : "/collections")`
- `browseGotoDetail(kind, slug)` → `router.push(`/${kind === "feed" ? "feeds" : "collections"}/${slug}`)`
- `browseNavigateToRecord(targetSlug, recordId)` → push the collection detail route,
  then `browseSetSelectedId(recordId)` (record stays a modal — decision 1)
- `browseClose()` → `router.push("/")`
- `browseRouteSlug()` → `router.currentRoute.value.params.slug` (string | undefined)
- `view` computed → derive `{ mode, kind, slug, selectedId }` from
  `router.currentRoute.value` (mode: closed / index / detail), with `selectedId`
  still read from the in-memory record state.
- **Keep in-memory state** for `selectedId` only (`browseSetSelectedId` /
  `browseRouteSelectedId` unchanged) — records are not routed.

`src/composables/collectionUi.ts` — **no change**: it already delegates to the
`browse*` functions (`gotoIndex`/`gotoDetail`/`navigateToRecord`/`routeSlug`/
`routeSelectedId`). The collection plugin's nav capabilities ride along for free.

`src/composables/useAccountingView.ts` — reimplement `accountingViewOpen/Close/isOpen`
on the router (`/accounting` ↔ route name), same seam pattern.

### 5. AppToolbar / GridView wiring

- `AppToolbar.vue`: the active-state computeds (`chatActive`, `collectionsActive`,
  `collectionDetail`, `accountingActive`) re-derive from `route.name` (they already
  read the `browse*`/accounting stores, which are now route-derived — minimal/no
  change). The button handlers already call `browseGotoIndex` etc., which now push
  routes; the `emit("go-single")` calls become unnecessary (a `router.push` already
  leaves the grid) — remove them and the `go-single` emit.
- `GridView.vue`: `@go-single="emit('exit')"` → exit now means `router.push("/")`;
  wire the toolbar's grid→single buttons to push directly. `go-grid` → `router.push("/terminals")`.

## Migration strategy

The **URL becomes the single source of truth**; the existing stores become thin
route derivations. Because every navigation already funnels through the centralized
`browse*` / `viewMode` setters, this can land as one coherent PR without touching
the many call sites:

1. Add router + `Stub` + `main.ts` wiring (no behavior change yet).
2. Add the server SPA fallback.
3. Flip `App.vue` to render by `route.name`; delete `viewMode`/localStorage.
4. Reimplement `browse*` and `useAccountingView` on the router singleton.
5. Trim `AppToolbar` / `GridView` of the now-redundant `go-single` plumbing.

## Edge cases / notes (留意点)

- **Deep-link reload** only works once the server fallback (step 2) is in — verify
  `/terminals` and `/collections/<slug>` reload correctly and that `/api/*` 404s
  still return JSON (not index.html), i.e. the regex guard holds.
- **Default redirect**: `/` is chat; unknown paths redirect to `/`. We drop the
  `localStorage("view_mode")` "remember last view" behavior (URL replaces it).
- **Grid toolbar**: the toolbar is shared by single and grid; from grid, pushing a
  route (e.g. `/collections`) must re-render the single shell — confirm App.vue's
  `isGrid` computed flips correctly.
- **socket.io / xterm WS**: double-check none of the live socket paths match the
  fallback regex (terminal attach, pubsub, MCP).
- **Record modal**: opening a record must NOT change the URL; closing it must NOT
  add history (decision 1) — keep it purely in `selectedId` state.

## Tests

- `src/router/index.spec.ts` (vitest): route table resolves expected names;
  unknown path redirects to `/`; `/collections/:slug` parses `slug`.
- `useCollectionBrowse.spec.ts`: `browseGotoDetail` pushes the right path;
  `view` computed reflects `currentRoute`; `selectedId` stays state-only.
- `server` fallback: a unit/integration check that `GET /api/<unknown>` does not
  return index.html, while `GET /collections/foo` (no extension, not API) does.

## Gates

`yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn test`

## Out of scope (separate efforts)

- **The Wiki feature itself** — this PR only reserves the `/wiki` routes. The wiki
  port (engine extraction into `@mulmoclaude/core/wiki`, MT server route, the
  read-only overlay/view) is its own plan. Agreed wiki constraints: **read-only**
  (Claude edits via the terminal), **no snapshots/history** initially.
- **Individual chat/terminal sessions as URLs** — explicitly not done.
- **Collection records as URLs** — explicitly not done (modal only).
- **`/settings` route** — stays a modal.
