# feat — in-place zoom for the active grid cell

## Goal

In the grid view, the terminal you're focused on lifts and grows slightly **in place**, so the active
cell is obvious at a glance — without the heavy filmstrip zoom (⤢) and without reflowing the grid.

## Constraint that shaped the design

The grid uses equal `1fr` CSS-grid tracks (`gridLayout.ts`). Enlarging one cell's track enlarges its
whole row+column, not just the cell. The clean single-cell effect is `transform: scale`, which the
user confirmed is what they want ("その場でzooming"). Because this app renders xterm with the **DOM
renderer** (no canvas), scaling real DOM text stays crisp — and `transform` doesn't change the cell's
layout box, so **xterm is not refit and the PTY is not resized** (no SIGWINCH churn on focus changes).

## Implementation (`src/components/TerminalGrid.vue` only)

- Track the focused cell: one delegated `@focusin` on `.grid`. `focusin` bubbles from the xterm
  textarea up, so `e.target.closest('[data-uid]')` gives the cell. Sticky — focus moving to the
  toolbar doesn't reset it; only another cell taking focus moves the emphasis.
- `cellClass(uid)` adds `focused` when `uid === focusedUid && expandedUid === null && uid !== flippingUid`,
  so it never fights the expand-FLIP or the filmstrip. Applied to all three cell types.
- CSS, scoped to the tiled grid (`.stage:not(.zoomed) .grid > .focused`): `transform: scale(1.045)`,
  `z-index: 5`, a soft shadow, a 140ms transition. Honours `prefers-reduced-motion`.

## Verification

- Unit (`TerminalGrid.spec.ts`): focus marks only that cell; a second focus moves the mark; focus
  leaving the grid is sticky; no zoom while expanded.
- Live (Puppeteer, two zsh cells): focusing cell A → `scale(1.045)`, `focused`; focusing B moves it.
  Critically, `offsetWidth` stayed constant (741px) in every state while the painted width grew to
  ~774px — proving the visual zoom with **no layout resize**.

## Notes / possible follow-ups

- Scale is subtle (1.045) per "若干"; trivially tunable if a stronger lift is wanted.
- The focused cell overflows its neighbours by ~2% each side; `z-index` + shadow make that read as a
  lift. Edge cells overflow the grid padding slightly — fine at this scale.
