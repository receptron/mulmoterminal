# Integrating `@mulmoclaude/collection-plugin` into MulmoTerminal

Status: **the cross-repo blocker is gone.** The package shipped `0.5.0`/`0.5.1` with exactly the
host-contract changes this doc originally said were still needed (ToolPlugin entry, router-optional
nav, configurable teleport target, server engine). What remains is **MulmoTerminal-side wiring only** —
**no MulmoClaude changes are required.**

This doc was originally written against `0.4.1` and assumed a future `0.5.0` was on the critical path.
It has been updated against the **published `@mulmoclaude/collection-plugin@0.5.1`** and the current
MulmoTerminal tree.

---

## TL;DR verdict

**Can this be done without any changes to MulmoClaude? Yes.** Everything MulmoTerminal needs is already
published in `@mulmoclaude/collection-plugin@0.5.1`:

- `./vue` exports a `plugin: ToolPlugin` (chat-result `View` + `Preview`) — the runtime registration
  shape MulmoTerminal uses, just like chart/form/markdown.
- Navigation is **router-optional**: `CollectionEmbedView` no longer renders a bare `<router-link>`;
  refs/embeds go through `collectionUi().navigateToRecord(slug, recordId?)` (`src/vue/refLink.ts`), and
  `recordHref`/`navigate` are optional so a router-less host returns `undefined`.
- The record modal teleports to a host-supplied target: `modalTeleportTarget?: () => string | HTMLElement`
  (defaults to `"body"`), so a Shadow-DOM host points it at an in-shadow node.
- `./server` exports the full read-side engine: `configureCollectionHost({ workspaceRoot, log, paths,
  isPresetSlug })` plus `discoverCollections` / `loadCollection` / `toSummary` / `toDetail` /
  `listItems` / `validateCollectionRecords`.

The **only** MulmoClaude artifact that is NOT packaged is the favorites/shortcuts format
(`Shortcut` type + `shortcuts-io`), which still lives in MulmoClaude's app tree. MulmoTerminal must
**reimplement that format verbatim** for the Tier 2 toolbar (see the drift warning). That is a
MulmoTerminal-side change — it requires no MulmoClaude edit. Extracting a shared shortcuts package
later (to eliminate drift risk) is optional and deferrable.

---

## Correction to the original plan: even the read-only card needs the server

The original doc claimed a "Tier 0 — read-only chat card, no server." **That is wrong for the 0.5.x
design.** `executePresentCollection` only echoes the addressing `{ collectionSlug, itemId? }` — it does
**not** embed records. The chat `View` passes just the `slug` to `CollectionView`, which then calls
`collectionUi().fetchCollectionDetail(slug)` to load the live schema + records (see
`CollectionView.vue` and `useCollectionRendering.ts`). So the smallest increment that actually renders
data is **frontend wiring + the server read route** — not a snapshot-only card.

This is consistent with the foundational model below: MulmoTerminal is a *second live view over the
shared workspace*, never a renderer of a passed-in snapshot.

---

## What's published and ready (`0.5.1`)

| Entry | Contents | MulmoTerminal needs it? |
|---|---|---|
| `.` | isomorphic core (schema, derive/formula, `TOOL_DEFINITION`/`executePresentCollection`, list/detail response types) | yes (tool def + types) |
| `./server` | node-only engine behind `configureCollectionHost(...)` + `discoverCollections`/`loadCollection`/`toSummary`/`toDetail`/`listItems`/`validateCollectionRecords` (read side) and CRUD/delete/views (write side) | yes (read side now; write later) |
| `./vue` | `plugin: ToolPlugin`, `configureCollectionUi()`/`collectionUi()`, `CollectionView`, `CollectionsIndexView`, all sub-views | yes |
| `./style.css` | compiled Tailwind | yes (inject into the shadow root) |

Peer deps: `gui-chat-protocol@^0.4.0` (MulmoTerminal already has it), `vue@^3.5`, `vue-i18n@^11.4.4`
(MulmoTerminal must add). The plugin owns its **own vue-i18n instance** (all 8 locales) — it needs no
host translation keys, only a `localeTag()`.

---

## MulmoTerminal architecture (the relevant facts)

- **Already consumes `@mulmoclaude/{chart,form,markdown,x}-plugin`** — imports `{ plugin } from "@X/vue"`
  in `src/plugins-registry.ts` and renders `getPlugin(toolName).viewComponent` in `GuiPanel.vue`. CSS is
  imported `?inline` and injected into a per-view **Shadow DOM** (`PluginFrame.vue` → `attachShadow` +
  `Teleport` into the shadow mount).
- **No vue-router** (so "navigate" = switch a panel's state).
- **No vue-i18n** yet (must add `vue-i18n@^11`).
- **Shared workspace**: `CLAUDE_CWD` (defaults to `~/mulmoclaude`) is the PTY cwd and the root for
  persisted state; `<workspace>/artifacts` is the user-browsable output area. Server backends are
  initialised at boot (`initMarkdownBackend`, `initArtifactsBackend`) — the same hook point where
  `configureCollectionHost` goes.

---

## Foundational model: two views over one workspace

MulmoClaude and MulmoTerminal **share a workspace**, and everything that matters is workspace state:

- **Collection definitions are skills** (`<workspace>/.claude/skills/<slug>/` + sibling `schema.json`,
  plus `~/.claude/skills` user scope) — shared.
- **Records** — shared, under the schema's data dir.
- **Favorites** = pinned launcher shortcuts at `<workspace>/config/shortcuts.json` — shared.

So MulmoTerminal is a second live view, not a snapshot renderer. To *show* collections its server must
wire the engine against the shared `workspaceRoot` using the **same path layout** MulmoClaude uses
(below), so discovery sees the same files.

### Shared path layout (must match MulmoClaude exactly)

| Host path | Value |
|---|---|
| `userSkillsDir` | `~/.claude/skills` |
| `projectSkillsDir(root)` | `<root>/.claude/skills` |
| `feedsRoot(root)` | `<root>/feeds` |
| `skillsStagingDir(root)` | `<root>/data/skills` |
| `archiveDir` | `archive` |
| `isPresetSlug(slug)` | `slug.startsWith("mc-") && slug.length > 3` |

---

## Gap analysis (updated for `0.5.1`)

| # | Original gap | Status |
|---|---|---|
| 1 | No `plugin: ToolPlugin` export | ✅ shipped — `export const plugin` in `./vue` |
| 2 | `<router-link>` / vue-router assumed | ✅ shipped — router-optional via `refLink.ts` + `navigateToRecord`/optional `recordHref`/`navigate` |
| 3 | `Teleport to="body"` escapes Shadow DOM | ✅ shipped — `modalTeleportTarget?: () => string \| HTMLElement` |
| 4 | vue-i18n peer | **[term]** add `vue-i18n@^11` |
| 5 | ~30 host-capability stubs | **[term]** most can stub; `fetchCollectionDetail`/`listCollections`/`localeTag`/`confirm` must be real |
| 6 | Server engine over shared workspace | **[term]** `configureCollectionHost` + read routes (now required for the card too, see correction above) |

### The binding (`CollectionUi`) — what's real vs stub for the read-side increment

Base the MulmoTerminal binding on MulmoClaude's `src/composables/collections/uiHost.ts`. For a
read-only card over the shared workspace:

- **Real:** `fetchCollectionDetail` (→ `GET /api/collections/:slug/detail`), `listCollections`
  (→ `GET /api/collections/list`), `localeTag` (host i18n), `confirm` (`window.confirm`-backed),
  `generalRoleId`/`personalRoleId` (constants), `pinToggle` (stub component rendering nothing for now).
- **Required-but-no-op for an embedded card:** routing fns `routeSlug`/`routeSelectedId`/`isFeedRoute`/
  `setSelectedId`/`gotoIndex`/`gotoDetail`/`navigateToRecord` (wired to view-state in Tier 2; safe
  no-ops until then).
- **Stub (write/feeds/views):** `createItem`/`updateItem`/`deleteItem`/`deleteCollection`/`deleteFeed`/
  `runItemAction`/`runCollectionAction`/`refreshCollection`/`deleteView`/`mintViewToken`/`fetchViewHtml`/
  `buildViewSrcdoc`/`listFeeds` → typed failure; `reconcileShortcuts`/`unpin` → no-op;
  `notifiedSeverities` → empty map; `startChat` → no-op (the card uses the `sendTextMessage` prop, not
  this binding hook).
- **Asset URLs:** `imageSrc`/`fileAssetUrl` resolve to `GET /api/files/raw?path=<workspace-relative>`
  (server/backends/files.ts), mirroring MulmoClaude's `resolveImageSrc`, so `image`/`file` fields and
  custom-view `<img>` thumbnails render. `fileRoutePath` stays null (no in-app File Explorer).

### Teleport + Shadow DOM

`PluginFrame` Teleports each card into a **per-instance** shadow `mount`, but `configureCollectionUi`
sets a **single global** binding — so `modalTeleportTarget` can't statically know which card's shadow
root to use. Approach: `PluginFrame` `provide()`s its shadow mount; a thin MulmoTerminal wrapper around
the collection `View` injects it and registers it as the "active" teleport target while mounted; the
binding's `modalTeleportTarget` returns that module-level active mount. Correct for the common
single-card case; multi-card simultaneously-open modals are an accepted v1 limitation (documented).

---

## Required feature: a collections toolbar (tabs) — the actual ask

MulmoClaude's top chrome (`PluginLauncher.vue` + `useShortcuts` + `PinToggle.vue`) has a **Collections**
button → the `/collections` index, plus one button **per favorite** → that collection's
`CollectionView`. Favoriting toggles the star.

MulmoTerminal equivalent needs three pieces, adapted to a no-router, state-driven host:

1. **A favorites store — SHARED via the workspace** `[term]`. Favorites are NOT app-local. MulmoClaude
   persists them server-side at **`<workspace>/config/shortcuts.json`** via `GET`/`PUT /api/shortcuts`.
   The on-disk shape is an **object wrapper** (NOT a bare array):

   ```jsonc
   { "shortcuts": [ { "kind": "collection" | "feed", "slug": "...", "title": "...", "icon": "..." } ] }
   ```

   (`mulmoclaude/src/types/shortcuts.ts` — wrapper "so the schema can grow without a migration".)
   MulmoTerminal must read/write **the same file in the same wrapper format**, plus a frontend
   `useShortcuts`-equivalent backing `pinToggle`/`unpin`/`reconcileShortcuts`.

   **Drift risk:** two independent writers of one on-disk format diverge over time (note `PUT` rewrites
   the whole object). **Recommended:** extract `shortcuts-io` + the `Shortcut` type into a shared
   package (the move that already worked for the collection engine). Pragmatic fallback: reimplement
   verbatim + a shared schema/fixture test. **Either way the format is the contract** — and a shared
   package would be the one optional MulmoClaude-side change in this whole effort.

2. **A launcher in `<header class="toolbar">`** `[term]` — a "Collections" button + a button per
   favorite, each switching the panel to a collection view.

3. **A state-based "collection browse" panel** `[term]` — since there's no router, a panel mode that can
   show `CollectionsIndexView` or a standalone `CollectionView(slug)`. The binding's nav fns map to this
   view state (the router-optional change makes this clean).

---

## Scope tiers

1. **Read-side foundation (this PR's increment).** Wire the server engine + read routes and the
   frontend ToolPlugin + binding, so a `presentCollection` chat card renders **real data from the shared
   workspace**. (Supersedes the old "Tier 0 — no server", which couldn't render anything.)
2. **Tier 1 — interactive card.** Inline edit + add/delete + actions. Adds the **write** routes
   (`items`/`item`/actions/refresh/views) + a real `startChat`.
3. **Tier 2 — browsable + toolbar (THE ASK).** Toolbar "Collections" button + per-favorite buttons →
   `CollectionsIndexView` / standalone `CollectionView(slug)`. Adds state-based nav, the
   shared-favorites store (`/api/shortcuts` over `config/shortcuts.json`) + launcher + browse panel.
   The `/feeds` half is optional — include only if feeds matter in a terminal UI. Tier 2 does **not**
   require Tier 1's write routes (browse is read-only until editing is added).

---

## Implementation sequence

1. ~~Package `0.5.0`~~ **DONE** — published as `0.5.1` (ToolPlugin + router-optional nav + teleport
   target + server engine). No further MulmoClaude work required for Tiers 0–2.
2. **MulmoTerminal — deps**: add `vue-i18n@^11` + `@mulmoclaude/collection-plugin@^0.5.1`.
3. **MulmoTerminal — server (read side)**: `configureCollectionHost({ workspaceRoot: CLAUDE_CWD, … })`
   at boot (using the shared path layout above); add `GET /api/collections/list` +
   `GET /api/collections/:slug/detail` backed by the package's read helpers.
4. **MulmoTerminal — frontend wiring**: register the `plugin` ToolPlugin in `plugins-registry.ts` +
   inject `style.css?inline`; implement the `collectionUi` binding (read real, write/chat/shortcuts
   stubbed per §gap 5); resolve the teleport target via the shadow-mount wrapper.
5. **MulmoTerminal — toolbar + favorites (Tier 2, the ask)**: decide shortcuts sharing (shared package
   vs verbatim+test); `GET`/`PUT /api/shortcuts` over `config/shortcuts.json`; a `useShortcuts`
   equivalent; the launcher in the toolbar; the browse panel mode.
6. **Tier 1 later**: write routes + `manageCollection` MCP tool + real `startChat`.

---

## Open questions for the maintainers

- **Shortcuts sharing**: shared package (recommended; the only optional MulmoClaude change) vs
  reimplement-verbatim + format test?
- **Browse panel placement**: replace the GuiPanel content, a new tab/pane, or overlay?
- **CSS isolation**: keep the shadow frame (and the teleport-target wrapper) or treat the collection
  plugin as first-party in light DOM?
- **Raw-file route**: add one so `image`/`file` fields render, or accept the v1 gap?
- **`/feeds`**: wanted, or collections-only?

Bottom line: **the package is drop-in-ready and needs zero MulmoClaude changes.** The work is entirely
in MulmoTerminal: server read engine + routes, the frontend ToolPlugin + binding + teleport wrapper,
then the toolbar/favorites/browse panel for the actual ask.
