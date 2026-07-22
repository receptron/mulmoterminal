// The terminal/GUI splitter's geometry rules.
//
// Both sides have a floor, and the window can be narrower than the two floors together —
// that is the case worth being careful about. When it is, the terminal's floor wins and the
// GUI gives up its own, because a terminal below its minimum reflows xterm into garbage
// while a squeezed GUI panel is merely cramped.

// Below this xterm's reflow stops being usable.
export const MIN_TERMINAL = 320;
// Enough of the GUI panel to still be worth showing.
export const MIN_GUI = 360;
// One arrow-key nudge.
export const SPLITTER_STEP = 16;

export function maxTerminalWidth(viewport: number): number {
  return Math.max(MIN_TERMINAL, viewport - MIN_GUI);
}

export function clampTerminalWidth(width: number, viewport: number): number {
  return Math.max(MIN_TERMINAL, Math.min(width, maxTerminalWidth(viewport)));
}

// The width a key produces, or null when the key is not ours — the caller must NOT
// preventDefault on null, or the separator would swallow Tab and Escape while focused.
export function splitterKeyWidth(key: string, current: number, viewport: number): number | null {
  if (key === "ArrowLeft") return clampTerminalWidth(current - SPLITTER_STEP, viewport);
  if (key === "ArrowRight") return clampTerminalWidth(current + SPLITTER_STEP, viewport);
  if (key === "Home") return MIN_TERMINAL;
  if (key === "End") return maxTerminalWidth(viewport);
  return null;
}
