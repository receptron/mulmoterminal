# A guide page of its own for cell order (#3603)

## Problem

How the grid orders cells is an everyday feature, but the guide explained it in three places nobody
looking for "ordering" lands on: a long bullet in `basics.md`, the `orderPriority` key in `config.md`,
and the worktree's inherited rank in another `config.md` section. The guide also used the internal
mode names (auto / manual / priority) while the menu says "Attention first" / "Manual" / "Project
priority".

## Decision

- New `docs/guide/{en,ja}/ordering.md`, `nav_order` 2.5 (right after Basics): switching the order,
  each order, ranking a project from Settings or `.mulmoterminal.json`, the launcher chips, worktrees,
  and what to check when cells are not where you expect. Written in the menu's own words, with a
  screenshot of the menu.
- Facts taken from the code, not the old prose: `orderCells` / `RANK` in `src/components/gridTabs.ts`
  (needs you, finished, idle, working; empty cells last; a stable sort over all pages),
  `common/dirPriorityOrder.ts` (unset after set, ties keep order), `reorderable` in `GridView.vue`
  (move buttons and roster drag only in Manual), the default `sortMode: "manual"`.
- `basics.md` and `features.md` keep one short line and link to the page; `config.md` keeps the key's
  reference and points to the page; both guide indexes list it.

## Left out

The feature list is rewritten in a separate PR.
