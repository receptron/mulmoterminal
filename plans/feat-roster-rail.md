# feat: fold the cockpit roster to a rail of status dots (#3271)

## Problem

Beside an enlarged cell the roster takes a fixed width; the splitter stops at `MIN_ROSTER`. A user
who only wants to know which session is waiting or finished cannot give the terminal that width.

## Where the switch lives

In the roster row's ⋮ menu (and its right-click), as the first item, above a divider: it is a
roster-wide action in a per-row menu, so it is kept away from the row's own items and at the
opposite end from Close. Not a double-click on a row header: a single click on a row already
enlarges that session and the header is the drag handle in manual sort.

Folded, the rows (and their ⋮) are gone, so the same menu has to be reachable from the rail:

- a right-click on a dot opens that row's menu (`hideTrigger`: a ⋮ per dot would double the rail's
  width), with **Expand the roster** first and the row's own items below;
- one ⋮ at the top of the rail (`rosterOnly`) offers only **Expand the roster**, for discoverability.

## The rail

- `TerminalGrid.vue`: `rosterCollapsed`, stored per browser as `roster_collapsed` beside
  `roster_width` — it is about how much of this screen the terminal gets, so it is not config.json.
  The width is kept while folded. The splitter is hidden while folded.
- One item per row, in `rosterRows` order, wearing `rosterAlertClass` (the rows' rings and blink),
  with a `STATUS_DOT_CLASS` dot. Hover shows `CockpitRow.title`; click / Enter / Space enlarges.
- `STATUS_DOT_CLASS` moves out of `CockpitHeader.vue` into `statusDot.ts` so both draw one colour.
- The filmstrip's menu has no roster prop and so no item.

## Other

- i18n: `rowMenu.collapseRoster` / `expandRoster` in five locales; the `rowMenu` block moves to
  `src/i18n/rowMenu/` because `en.ts` and `ja.ts` reached the line limit. Keys are unchanged.
- Docs: `docs/guide/{en,ja}/basics.md`, the zoom section.

## Tests

- `CockpitRowMenu.spec.ts`: item order with `roster`, the emitted value, none in the filmstrip,
  `rosterOnly`, `hideTrigger` opening at a point.
- `TerminalGrid.spec.ts`: fold from a row menu (rail, no splitter, stored), restore folded on mount,
  dot names and rings, click enlarges, unfold from a dot's right-click and from the top ⋮.
