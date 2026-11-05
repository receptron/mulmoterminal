# fix: the folded roster's dots are parked off-screen (#3278)

## Problem

The rail from #3275 rendered its top ⋮ and no dots. Each dot carried the Tailwind utility `grid`,
and TerminalGrid's scoped `.stage.zoomed.listmode .grid` parks the cell grid at `left: -99999px`
(900x600, #1125). The scoped selector matches every element of this template with that class, so
the dots were parked with the cells. jsdom applies no scoped CSS, so the specs could not see it.

## Change

- The rail dot lays out with `flex items-center justify-center` instead of `grid place-items-center`.
- `test/src/components/terminalGridClassCollision.spec.ts` reads the template and requires that only
  the cell grid carries the class `grid`, statically or through a `:class` binding.

## Not changed

Renaming the scoped `.grid` would remove the trap for good, but the stylesheet is the grid's layout
state machine and the class is referenced across it; the spec holds the line instead.

## Verified

Real browser, scratch HOME, rebuilt client: the rail shows one dot per session and the hover names it.
The spec fails with the old class and passes with the fix.
