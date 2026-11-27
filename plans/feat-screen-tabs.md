# Screen tabs (#3575, part 3 of 3)

Parts 1 and 2 keep the screens alive and give them keys; this part shows the ones opened so far and
switches between them directly.

## What

- `screenTabsModel.ts` (pure): `screenOfRoute` maps each overlay route to its screen (the Wiki's
  pages, graph and lint are one screen; so are Rooms and a room, Blueprints and a build, PRs and the
  board). The worklog is the wiki filtered to a tag, so it is the Wiki's tab. `visitTab` keeps one
  tab per screen in first-opened order, each holding the last full path inside it; `closeTab`
  removes one and names the tab to show instead (the next, else the previous, else none).
- `useScreenTabs.ts`: records every navigation into a screen; showing a tab goes back to its path
  through `returnToPlace` (shared with `screen-toggle`), with a fresh origin.
- `ScreenTabs.vue`: a strip under the toolbar, up only while a screen is in front, with the grid
  first. Closing the front tab shows the next one, or goes back to the grid.
- Layout: the screens start at `--screen-top` instead of `top-10`. `style.css` sets it from
  `:root:has([data-screen-tabs])`, so no screen has to know the strip exists.

## Decisions

- Not shown on the grid: the grid's own toolbar is there, and the space is the terminals'.
- Closing a tab forgets the tab only; the kept screen stays in the DOM (part 1) until reload.
- Tabs reset on reload: they record this page's visits, not a saved layout.
