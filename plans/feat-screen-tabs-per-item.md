# A tab per opened collection and feed (#3598)

## Problem

The screen tabs (#3575) key on the screen alone, so `collectionDetail` shares the `collections`
tab with the index: opening a second collection rewrites the one tab, and the first is gone. Feeds
do the same.

## Decision

- A tab is keyed, not just screened. The index routes keep the screen as their key; a
  `collectionDetail` / `feedDetail` route is an ITEM tab keyed by screen + project + slug.
  The project is part of the key for the reason `pageKeyFor` gives in `useCollectionBrowse.ts`:
  two projects' `/collections/tasks` are different collections.
- A new item tab goes after the last tab of its screen; a new index tab goes before the first item
  tab of its screen. Anything else is added last, as before.
- Visiting a key already open moves that tab's path; it never adds a second tab.
- An item tab shows the item's title and icon from the list endpoint its index already uses
  (`/api/collections/list`, `/api/feeds`, with `?project=`), and the slug until that answers. The
  rule says when a read IS made: a visit that shows one of a list's tabs reads that list, and a
  list that never answered is read on every visit. An answer replaces the previous one, so a rename,
  an addition and a deletion all arrive through the same read; a failed read keeps the last answer.
  A visit made while its list is being read is owed one more read when that one settles. The
  watcher follows the tabs only, so there is at most a read per visit and never a loop.

## Left out

Rooms and Blueprints keep one tab: their list is a sidebar beside the open item, so a tab per
item would add one on every sidebar click. The wiki is unchanged.

## Files

- `src/composables/screenTabsModel.ts` — `tabOfRoute`, keyed `visitTab` / `closeTab` (pure).
- `src/composables/screenTabItemLabels.ts` — parsing a list response, which lists to read (pure).
- `src/composables/useScreenTabItemLabels.ts` — the fetches and the cache.
- `src/composables/useScreenTabs.ts`, `src/components/ScreenTabs.vue` — by key, item labels.
