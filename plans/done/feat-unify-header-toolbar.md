# feat: unify the header toolbar across single and grid views

## Problem

The header menu differs between the single (classic) view and the grid (multi-terminal)
view:

- **single** (`src/App.vue`): icon-based launcher (Material Symbols) — Chat / Grid /
  Collections / Accounting / pinned favorites, plus `NotificationBell`, a sound toggle
  and Settings on the right.
- **grid** (`src/components/GridView.vue`): a simpler text/emoji bar — `＋ Terminal`,
  🔔 sound, `▢ Single`, ⚙ Settings. No launcher, no notification bell.

The user wants the grid view to use the *standard* (single-view) header so both views
share one identical toolbar.

## Approach (full unification)

Extract the standard toolbar into a shared `src/components/AppToolbar.vue` and render it
in both views.

- The toolbar reads the global singleton stores directly (`useShortcuts`,
  `useCollectionBrowse`, `useAccountingView`, `useSoundEnabled`) and takes `viewMode`
  as a prop.
- Launcher buttons that target single-view surfaces (Chat / Collections / Accounting /
  favorites) mutate the global browse/accounting state and emit `go-single`; the parent
  switches to the single view, where the overlay is already rendered. The Grid button
  emits `go-grid`.
- Active-state highlighting is gated on `viewMode === 'single'` so that in the grid view
  only the Grid button reads as active.
- The grid-specific `＋ Terminal` action becomes an icon button (`add`) shown only when
  `viewMode === 'grid'`; it emits `add-terminal`. Settings emits `settings`. Sound is
  toggled inside the toolbar via the shared singleton.

### Wiring

- `App.vue` single shell: `<AppToolbar :view-mode="viewMode" @go-grid="viewMode='grid'"
  @settings="showSettings = true" />`. Drops its inline `<header>` and the now-unused
  launcher state/handlers/styles (`shortcuts`, `browseView`, `favActive`, `showChat`,
  `showCollections`, `showFavorite`, `showAccounting`, `NotificationBell`, sound toggle).
- `GridView.vue`: `<AppToolbar :view-mode="'grid'" :add-terminal-active="launchOpen"
  @go-single="emit('exit')" @add-terminal="onAddTerminal" @settings="showSettings=true" />`.
  Drops its inline `<header>`, `useSoundEnabled`, and the `.tb-btn`/`.tb-add` styles. The
  page tab bar stays below the shared toolbar.

## Files

- **new** `src/components/AppToolbar.vue`
- `src/App.vue`
- `src/components/GridView.vue`

## Verification

- `yarn format`, `yarn lint`, `yarn build`, `yarn typecheck`
- Manual: in both views the toolbar is identical; Grid highlights in grid mode; `＋`
  appears only in grid; Chat/Collections/Accounting/favorite from grid switch to single
  and open the right surface; sound + settings + bell work in both.
