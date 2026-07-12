# fix: grid focus-zoom clips characters at the browser edge (#331)

## Symptom

In the grid view, when a cell is "enlarged" the outermost characters run past the
browser edge and can't be read (「拡大したときにブラウザの端を超えて一部字が読めない」).

## Root cause (reproduced, not guessed)

Driving the app with puppeteer and walking the DOM from the xterm canvas up:

- The **⤢ expand** (`.stage.zoomed`) terminal fits fine at every width (measured
  27px of margin) — it is **not** the culprit.
- The culprit is the **focus-zoom** (#310): the keyboard-focused cell grows via
  `.stage:not(.zoomed) .grid > .focused { transform: scale(1.045) }`. A `scale`
  grows the element from its centre by a fraction of its own size. For a wide/edge
  cell (worst case: a single full-width cell) that pushes the left/right edges
  ~8–13px **past** the viewport at 1280–2200px wide (and ~7px past the bottom).
  The grid's `6px` padding can't absorb it, and the viewport's `overflow: hidden`
  clips the overflowing characters.

Because the growth is proportional to the cell (hence to the window) size, a
**fixed** padding cannot cover it across window sizes.

## Fix

`src/components/TerminalGrid.vue`:

1. Inset the **non-zoomed tiled grid** by an amount that tracks the cell size on
   each axis so it always matches the scale:
   `.stage:not(.zoomed) .grid { padding: calc(6px + 1.5vh) calc(6px + 1.6%); }`
   - `%` (width-relative) horizontally, `vh` (height-relative) vertically.
   - Scoped to `:not(.zoomed)` so the zoomed filmstrip keeps its own padding.
2. Trim the scale `1.045` → `1.03` so the reserved inset stays modest while the
   emphasis (scale + shadow + brighter header) remains clearly visible.

## Verification (puppeteer, real xterm)

- Single full-width cell (worst case): focused edges land **inside** the viewport
  at every tested size — 1280×800, 1366×768, 1440×900, 1600×900, 1920×1080,
  1920×1200, 2200×1000, 1280×1440 (0 clipping cases).
- 4-cell grid, right-most cell focused: right edge 19px inside the viewport,
  emphasis still clearly readable.

## Out of scope

The `min-width: 0` horizontal analog on `.terminal-container` was investigated and
reverted — the expand path was already correct, so it was an unrelated change.
