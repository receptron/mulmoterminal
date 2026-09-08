# The grid's three view modes

`TerminalGrid.vue` is **one** `.stage` element in three CSS states, not three screens. Getting
this wrong is easy and expensive: a change that reads as "collapse the cell" is already built for
one mode, impossible in another, and lands on a completely different component in the third.

## The three modes

Two booleans decide everything: `zoomed` (some cell is enlarged) and `listMode` (which zoomed
layout). `listMode` defaults to **true**, so the roster is what you get when you enlarge a cell.

| | condition | `.grid` becomes | the enlarged cell | the others |
| --- | --- | --- | --- | --- |
| **Tiled grid** | `!zoomed` | CSS grid, tracks from `trackStyle(layoutForCount(n))` | — | tiles |
| **Cockpit roster** | `zoomed && listMode` | absolutely positioned **off-screen** (`left:-99999px`, 900x600) | teleported to `.zoom-main`, right of the roster | a **separate text row** in the `<aside>` |
| **Filmstrip** | `zoomed && !listMode` | horizontal flex strip (`flex: 0 0 150px`, user-resizable) | teleported to `.zoom-main`, above the strip | 260px-wide thumbnails |

## The five facts that keep being re-derived wrong

**1. There is one component instance per cell, and it is always mounted.**
The `.grid` div renders every cell in `props.cells` unconditionally. A `<Teleport>` moves the
enlarged one into `.zoom-main`, and a chat's cell into the pane under an open collection. So a single
`TerminalCell` is, over its life, a tile / a thumbnail / the enlarged terminal / an off-screen box —
without ever being remounted. Anything a cell renders must therefore make sense in all four
positions, or be conditioned on the mode.

**2. Off-screen is not unmounted.** In roster mode the non-expanded cells keep a real 900x600 box
parked at `left:-99999px`. That is deliberate (#1125): a zero-sized box makes xterm fit itself to
zero. Connections, metadata and status stay live there. "Not visible" and "not running" are
different states and only the first one is true.

**3. Which cells reach `TerminalGrid` differs by mode.** `visibleOrdered()` orders the whole flat
cell array, then:

- **un-zoomed** -> `pageSlice()`: the active page's **<=9** cells (tabs are pages of 9)
- **zoomed** -> no slice: **every cell on every page**

So the roster and the filmstrip list *everything you have open*, while the tiled grid shows *one
page*. A feature that reduces what is on screen means something different in each.

**4. The roster row is not a `TerminalCell`.** It is a separate template in `TerminalGrid.vue`
driven by `listRows: CockpitRow[]` (`GridView.vue`: `orderedCells.map(rosterRow)`), built from
`CockpitHeader` plus the memo / summary / prompt / reply lines, and coloured by its own
`rosterAlertClass()`. Cell chrome (`CELL_STATUS`, `HEADER_STATUS`, `DOT_STATUS` in `TerminalCell`)
does not reach it, and roster chrome does not reach the cells. Two places, deliberately kept in
step by the shared `activityStatus()` — not one.

**5. A cell's teleport is keyed by WHERE it is going, not only by which cell it is.**
`<Teleport>` keeps the target it had when it was last enabled: change `to` while it is **disabled**
and re-enable it later, and the children are moved into a node that has since left the document —
they are then in no view at all. That is not hypothetical. The grid has three destinations now
(tile / `.zoom-main` / the collection pane), and moving a cell pane → tile → zoom lost the terminal
entirely until the `v-for` key carried the placement (`cellTeleport.ts`, #2001).

Two consequences worth keeping:

- **Tile ↔ zoom deliberately shares one key.** The zoom's FLIP animation measures elements before
  the switch and moves them after; a re-key there would hand it different elements.
- **A re-key remounts the cell, and that is safe *because the slot is durable*.** `attach`
  re-parents the same xterm instead of reconnecting, which is the same mechanism paging already
  relies on. It would not be safe for anything a cell holds in its own state.

`PluginFrame.vue` reaches the same place from the other side (`<Teleport v-if="target" :to="target">`):
a teleport that exists only while its target does.

## How a cell knows where it is

`gridCellProps()` already passes both booleans to every cell, so no new plumbing is needed:

| want | condition |
| --- | --- |
| I am a tile in the tiled grid | `!zoomed` |
| I am the enlarged terminal | `expanded` |
| I am a thumbnail or off-screen | `zoomed && !expanded` |

## What each mode is short of

Different scarcity per mode, which is why one treatment rarely serves all three:

- **Tiled grid** — screen area. Nine equal `1fr` tracks; nothing can be given less room without a
  second layout mechanism.
- **Cockpit roster** — list length. Rows are cheap but every open session adds one, across all pages.
- **Filmstrip** — horizontal scroll length. Same population as the roster, wider per item.

## Related

- `docs/styling.md` — why chrome is Tailwind utilities and what breaks when two utilities set one
  property.
- `src/components/attentionStatus.ts` — `activityStatus()`, the one rule the grid, roster, sidebar
  and tab bar all read "whose turn it is" from.
