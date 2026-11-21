# feat: the board can show only the work a terminal is open on (#3359)

## Why

The board lists every open issue, every open PR and the recent merges, so the handful of things the
open terminals are working on has to be picked out of it by eye.

## Rule (pure, `src/components/boardOpenWork.ts`)

- `openWorkOnly`: keep a card only when it carries a cell. A repo left with no card is dropped,
  unless it carries an error, which is still worth seeing. The loaded board is not mutated.
- `visibleColumns`: every column when the switch is off; only the columns holding a card when on.
- A merged card with a cell stays: the terminal left open on merged work is worth noticing.
- A cell on the default branch is on no card (the server's rule), so it is not shown either.

## Switch (`src/composables/useBoardOpenWorkOnly.ts`)

- Per browser in `localStorage`, the same shape as the copy-mode banner switch.
- **On by default.** Only the exact stored `"0"` turns it off, so an unset or unreadable value lands
  on the default.

## UI

- A checkbox in the board header.
- On, with nothing left: a line saying no terminal is open on any work, and a button turning the
  switch off.
- The grid keeps its five tracks, so a column keeps its usual width when the others are dropped (one
  column stretched across the page read as broken).
- The selection is looked up among the visible cards, so turning the switch on closes the panel of a
  card that just left the screen.

## Out of scope

A terminal opened or closed is reflected on the next read (the minute tick, or the reload after a
turn ends), not at once: the live feed updates a known cell's state but does not add or drop cells.
