// How far one wheel/trackpad gesture scrolls the terminal, as a multiplier on the xterm
// default (1 = xterm's own speed). Shared because both sides decide from the same numbers:
// the Settings stepper bounds its own buttons, and the client re-validates what it reads back
// out of localStorage.
//
// It drives BOTH scrolling paths, which are different code: xterm's `scrollSensitivity` for
// the normal buffer's scrollback, and the wheel-report accumulator in ./mouseReports for a
// full-screen TUI in the alternate buffer (Claude Code). One setting, because to the person
// scrolling they are the same gesture.
export const TERMINAL_SCROLL_SPEED_DEFAULT = 1;
// A macOS trackpad emits a wheel event every few pixels, so the useful range sits below 1 —
// 0.25 is "a swipe moves a paragraph", still fast enough to cross a long transcript. Above 3
// a single flick outruns the renderer and lands nowhere readable, which is the complaint this
// setting exists to answer.
export const TERMINAL_SCROLL_SPEED_MIN = 0.25;
export const TERMINAL_SCROLL_SPEED_MAX = 3;
export const TERMINAL_SCROLL_SPEED_STEP = 0.25;

// Clamp rather than reject an out-of-range number, for the same reason the font size does:
// honouring the direction the user asked for reads as working, where snapping back to the
// default reads as ignored. Non-numeric input means "nothing set here" and stays null so the
// caller can fall back. Values are snapped to the step so the label stays readable (0.75, not
// 0.7499999) and so the stepper can't drift off its own grid.
export function normalizeScrollSpeed(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  const clamped = Math.min(TERMINAL_SCROLL_SPEED_MAX, Math.max(TERMINAL_SCROLL_SPEED_MIN, input));
  const snapped = Math.round(clamped / TERMINAL_SCROLL_SPEED_STEP) * TERMINAL_SCROLL_SPEED_STEP;
  // The multiply above reintroduces binary-float noise (0.30000000000000004); two decimals is
  // more than the step needs and leaves the value safe to compare and to render.
  return Math.round(snapped * 100) / 100;
}
