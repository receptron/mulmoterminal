// The geometry rules every splitter in the app shares.
//
// Both sides have a floor, and the space can be smaller than the two floors together —
// that is the case worth being careful about. When it is, the terminal's floor wins and the
// other side gives up its own, because a terminal below its minimum reflows xterm into garbage
// while a squeezed panel is merely cramped.
//
// Four splitters now answer to this: terminal|GUI in the single view, and — beside an enlarged
// grid cell — terminal|file-pane, roster|terminal, and terminal/thumbnail-strip. Stated once
// because four copies of a tie-break drift apart, and the drift only shows on the narrow window
// nobody develops on.

/** The two floors of one splitter. `primary` is the side whose floor SURVIVES when the two do
 *  not both fit — always the terminal's, for the reason in the header. */
export interface SplitFloors {
  primary: number;
  secondary: number;
}

// Below this xterm's reflow stops being usable.
export const MIN_TERMINAL = 320;
// The same thing vertically: fewer rows than this and the terminal shows a line or two of a
// conversation, which is not a terminal anyone can work in.
export const MIN_TERMINAL_HEIGHT = 200;
// Enough of the GUI panel to still be worth showing.
export const MIN_GUI = 360;
// A roster row carries status / dir / summary / prompt / reply. Narrower than this and every
// line is ellipsis, so the roster stops answering the question it exists for.
export const MIN_ROSTER = 240;
// Enough of a thumbnail to recognise: its header plus a slice of the terminal under it.
export const MIN_STRIP = 100;
// One arrow-key nudge.
export const SPLITTER_STEP = 16;

/** A vertical separator is driven by Left/Right, a horizontal one by Up/Down. */
export type SplitterAxis = "horizontal" | "vertical";

/** Where the terminal sits relative to the separator. The file pane and the GUI panel are AFTER
 *  their terminal; the roster is BEFORE its one. It has to be said because it decides which way
 *  a key moves things — see splitterKeySize. */
export type PrimarySide = "before" | "after";

export const TERMINAL_GUI: SplitFloors = { primary: MIN_TERMINAL, secondary: MIN_GUI };
export const TERMINAL_ROSTER: SplitFloors = { primary: MIN_TERMINAL, secondary: MIN_ROSTER };
export const TERMINAL_STRIP: SplitFloors = { primary: MIN_TERMINAL_HEIGHT, secondary: MIN_STRIP };

export function maxPrimary(available: number, floors: SplitFloors): number {
  return Math.max(floors.primary, available - floors.secondary);
}

/** Clamp the side whose floor wins. */
export function clampPrimary(size: number, available: number, floors: SplitFloors): number {
  return Math.max(floors.primary, Math.min(size, maxPrimary(available, floors)));
}

/** The same rule read from the other side, for a splitter that stores the SECONDARY side's size
 *  (the file pane, the roster, the strip) rather than the terminal's. Stating it in terms of
 *  `clampPrimary` is what keeps the two directions from drifting apart.
 *
 *  Floored at zero: on a space smaller than the primary's own floor, `clampPrimary` answers more
 *  than there is — correctly, it is the floor that must survive — and the remainder goes
 *  NEGATIVE. A negative flex-basis is not a size the browser can use, so it falls back to the
 *  stylesheet's and the panel springs open at its default width. */
export function clampSecondary(size: number, available: number, floors: SplitFloors): number {
  return Math.max(0, available - clampPrimary(available - size, available, floors));
}

/** The primary size a key produces, or null when the key is not ours — the caller must NOT
 *  preventDefault on null, or the separator would swallow Tab and Escape while focused.
 *
 *  Every key moves the SEPARATOR — one step toward the start, toward the end, or all the way to
 *  either limit. Which of those GROWS the terminal depends on the side it is on, which is why
 *  `primarySide` exists: read it the other way round and the arrow key walks the separator in
 *  the opposite direction from the pointer that just dragged it. */
export function splitterKeySize(
  key: string,
  current: number,
  available: number,
  floors: SplitFloors,
  axis: SplitterAxis = "horizontal",
  primarySide: PrimarySide = "before",
): number | null {
  const towardStart = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const towardEnd = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
  const stepToStart = primarySide === "before" ? -SPLITTER_STEP : SPLITTER_STEP;
  if (key === towardStart) return clampPrimary(current + stepToStart, available, floors);
  if (key === towardEnd) return clampPrimary(current - stepToStart, available, floors);
  if (key === "Home") return primarySide === "before" ? floors.primary : maxPrimary(available, floors);
  if (key === "End") return primarySide === "before" ? maxPrimary(available, floors) : floors.primary;
  return null;
}

// The single view's terminal|GUI splitter, named. The wrappers stay because the domain names
// carry meaning the generic ones cannot, and because a caller that only ever has one pair of
// floors should not have to name them at every call.
export const maxTerminalWidth = (viewport: number): number => maxPrimary(viewport, TERMINAL_GUI);
export const clampTerminalWidth = (width: number, viewport: number): number => clampPrimary(width, viewport, TERMINAL_GUI);
export const clampPaneWidth = (paneWidth: number, available: number): number => clampSecondary(paneWidth, available, TERMINAL_GUI);
export const splitterKeyWidth = (key: string, current: number, viewport: number): number | null => splitterKeySize(key, current, viewport, TERMINAL_GUI);
