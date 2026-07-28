// The grid cells' shared chrome — the Claude cell (TerminalCell), the command cell, and the
// launcher cell — as Tailwind utility strings, so the styling travels with the markup
// (docs/styling.md). It used to be scoped CSS (cellChromeBase.css / cellChrome.css), which
// silently failed to reach a component whose template has a fragment root: Vue gives the
// parent's scope id to a single root element only (#787).
//
// The `cell-*` class names stay on the elements as state and query hooks. They carry no
// styling now, so the specs that select on them aren't coupled to how a cell looks.

export const CELL_FRAME =
  "group/cell flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-[var(--cell-border,var(--border))] bg-[var(--cell-bg,var(--bg-base))]";

// Everything inside a cell lives in one wrapper so the focus zoom can cancel itself out.
// The focused cell scales up by --focus-zoom (TerminalGrid's `.focused`); this scales back down by
// the inverse OF THE SAME TOKEN, and because the wrapper's box is the cell's own box the two share
// a centre — the content's composed transform is exactly identity, so the terminal's canvas keeps
// its 1:1 rasterisation while the frame around it grows (#965).
//
// It has to wrap ALL of the cell's children, header included. A wrapper that starts below the
// header has its own centre, and cancelling about the wrong centre leaves a sub-pixel translation
// which blurs the canvas just the same — measured at 14% of the canvas's pixels changed, against
// 0% for this.
export const CELL_INNER =
  "flex min-h-0 min-w-0 flex-1 flex-col transition-transform duration-[140ms] ease-[ease] group-[.focused]/cell:scale-[calc(1/var(--focus-zoom))] motion-reduce:transition-none";

export const CELL_HEADER = "flex h-[34px] flex-none items-center gap-2 border-b border-b-border bg-[var(--cell-header-bg,var(--bg-panel))] px-2";

// Added only while a click on the header background zooms the cell.
export const CELL_HEADER_ZOOMABLE = "cursor-pointer hover:bg-hover";

// Shape without a colour: the caller picks one of the tints below, so an active state and the
// idle tint never land on the same element as two competing `bg-*` utilities — which of them
// wins is decided by Tailwind's output order, not by the order they are written in.
export const CELL_DOT = "h-[9px] w-[9px] flex-none rounded-full";
// A directory's configured colour tints the idle dot; a status replaces it outright.
export const CELL_DOT_IDLE = "bg-[var(--cell-dot,var(--text-dim))]";
export const CELL_DOT_WORKING = "bg-accent animate-cell-pulse";

export const CELL_ACTIONS = "flex flex-none gap-1";

// Split into box / size / ink for the same reason as the dot: a caller that resizes a button
// or gives it its own colours swaps ONE piece instead of layering a second utility for a
// property that is already set.
// Shape WITHOUT a fill, so the idle and pressed variants can each name their own `bg-*` instead
// of layering one over `bg-transparent` — which of two competing utilities wins is decided by
// Tailwind's output order, not by the order they are written in (the same rule as the dot above).
export const CELL_BTN_SHAPE = "inline-flex items-center justify-center rounded-md border-none leading-none";
export const CELL_BTN_BOX = `${CELL_BTN_SHAPE} bg-transparent`;
export const CELL_BTN_SIZE = "h-[26px] w-7 text-[16px]";
export const CELL_BTN_INK = "cursor-pointer text-[var(--cell-btn,var(--text-secondary))] hover:bg-hover hover:text-fg";
export const CELL_BTN = `${CELL_BTN_BOX} ${CELL_BTN_SIZE} ${CELL_BTN_INK}`;
// Ink for a button that can be DISABLED. The hover affordances are `enabled:`-prefixed, or a
// button that cannot be pressed still lights up under the cursor and reads as pressable; the
// dimming is what says it is there but unavailable. Same idiom as the launcher's ▶ button.
export const CELL_BTN_INK_DISABLEABLE = `enabled:cursor-pointer text-[var(--cell-btn,var(--text-secondary))] enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40`;
export const CELL_BTN_DISABLEABLE = `${CELL_BTN_BOX} ${CELL_BTN_SIZE} ${CELL_BTN_INK_DISABLEABLE}`;

// The header button whose pane is CURRENTLY OPEN. Files, Canvas and Tools share one slot beside
// the enlarged terminal, so exactly one of them can be in this state — and which one has to be
// readable without moving the pointer. Idle chrome differs from hover by a background alone,
// which says nothing once the cursor is elsewhere, so this fills AND recolours the ink.
//
// The same --bg-selected the rest of the app marks a selection with, rather than a colour of its
// own: a header button is not a new kind of selected thing. Note it is not `--cell-btn`-tinted —
// a directory's chrome colour drives the IDLE ink, and letting it drive this one too would make
// "selected" mean a different shade per directory.
export const CELL_BTN_ACTIVE = `${CELL_BTN_SHAPE} ${CELL_BTN_SIZE} cursor-pointer bg-selected text-accent hover:bg-selected-hover hover:text-accent`;
export const CELL_CLOSE_BTN = `${CELL_BTN_BOX} ${CELL_BTN_SIZE} cursor-pointer text-[var(--cell-btn,var(--text-secondary))] hover:bg-[var(--err-hover-bg)] hover:text-err-text`;

// A path clipped from the FRONT: `rtl` puts the ellipsis at the start so the tail — the
// project dir, the part that identifies the cell — survives a narrow column. `text-left` comes
// with it because rtl also flips the default alignment, which would push a path short enough to
// fit over to the trailing edge. The path text itself must carry CELL_DIR_PATH, or rtl would
// reorder the trailing "/" and punctuation.
export const DIR_TRUNCATE_FRONT = "truncate text-left [direction:rtl]";
export const CELL_DIR_PATH = "[unicode-bidi:plaintext]";

// Floored at ~15 characters of path so it stays readable in a narrow cell.
export const CELL_DIR = `min-w-[16ch] max-w-[45%] flex-initial ${DIR_TRUNCATE_FRONT} font-mono text-[11px] text-[var(--cell-header-fg,var(--text-dim))]`;

export const CELL_CMD = "min-w-0 flex-auto truncate font-mono text-[12px] text-secondary";

export const CELL_TERM = "min-h-0 flex-1";
