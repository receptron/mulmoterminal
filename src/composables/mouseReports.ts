// The synthesis half of the #729 mouse-tracking swallow. Dropping the tracking SETs keeps a drag
// a text selection, but it also hides the mouse from the app:
//
// - the wheel: xterm treats an alt-buffer app as "no scrollback, no mouse" and converts wheel
//   events into arrow keys — which a TUI like Claude binds to input history, so scrolling spun
//   the prompt history instead (#737);
// - clicks: the app's own click targets ("Jump to bottom", "1 new message") never hear from the
//   pointer, so they read as dead buttons (#845).
//
// The repair for both: remember which tracking modes were swallowed, and when the swallowed app
// is in the alternate buffer, hand it the SGR report it originally asked for. Drags stay
// selections.

const WHEEL_TRACKING_MODES = new Set([1000, 1001, 1002, 1003]);
const SGR_ENCODING_MODE = 1006;
const WHEEL_UP_BUTTON = 64;
const WHEEL_DOWN_BUTTON = 65;
const MAIN_BUTTON = 0;
// A press and release within this distance is a click, not a drag: it absorbs the pointer drift
// of an ordinary click without swallowing the start of a real selection.
const CLICK_SLOP_PX = 3;

const modeOf = (param: number | number[]): number | undefined => (Array.isArray(param) ? param[0] : param);

/** Record the modes of a swallowed SET, so the mouse handlers know what the app wanted. */
export function recordSwallowedModes(active: Set<number>, params: readonly (number | number[])[]): void {
  params.forEach((param) => {
    const mode = modeOf(param);
    if (mode !== undefined) active.add(mode);
  });
}

/** Forget modes the app reset — resets pass through to xterm untouched (#729), but the
 *  record must follow them or a closed TUI would keep synthesizing reports forever. */
export function clearResetModes(active: Set<number>, params: readonly (number | number[])[]): void {
  params.forEach((param) => {
    const mode = modeOf(param);
    if (mode !== undefined) active.delete(mode);
  });
}

/** True when the app asked for mouse tracking AND the SGR encoding. Non-SGR encodings are
 *  deliberately out of scope: every current target (Claude, Codex) requests 1006, and
 *  synthesizing legacy X10 bytes for the rest isn't worth the surface. */
export function wantsMouseReports(active: ReadonlySet<number>): boolean {
  if (!active.has(SGR_ENCODING_MODE)) return false;
  return [...active].some((mode) => WHEEL_TRACKING_MODES.has(mode));
}

const sgrReport = (button: number, col: number, row: number, released = false): string => `\x1b[<${button};${col};${row}${released ? "m" : "M"}`;

/** The SGR wheel report for a wheel movement, or null when there is no vertical motion.
 *  Button 64 is wheel-up, 65 wheel-down; col/row are 1-based cell coordinates. */
export function wheelReportSequence(deltaY: number, col: number, row: number): string | null {
  if (deltaY === 0) return null;
  return sgrReport(deltaY < 0 ? WHEEL_UP_BUTTON : WHEEL_DOWN_BUTTON, col, row);
}

// ── Wheel notches ────────────────────────────────────────────────────────────────────────
// A wheel MOUSE emits one event per detent, so "one event, one report" is right for it. A
// macOS trackpad does not: a two-finger swipe emits a burst of dozens of pixel-delta events
// (plus momentum), and reporting each one as a detent handed a TUI ~3 lines per event — a
// gentle swipe jumped a hundred lines and the reader lost their place (#978).
//
// The repair is the accumulation xterm does for its own scrollback and which the #737 swallow
// bypasses: convert a delta to LINES, bank the fraction, and report only whole notches. Both
// buffers then scroll at the same rate, and one multiplier (`speed`) tunes both.
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
// A trackpad's per-event delta is small; a wheel's is large (macOS/Chrome report ~120 per
// detent). Below this threshold the gesture is treated as a trackpad swipe, which is the
// distinction xterm itself draws rather than trying to identify the device.
const TRACKPAD_PIXEL_DELTA = 50;
// How many notches a swipe is worth per cell of finger travel. Above 1 because a notch is not a
// line: what receives these reports is tmux's copy-mode, bound to ONE line per report (#978, see
// WHEEL_SCROLL_BINDINGS in server/infra/tmux.ts), and a swipe should move the text a little
// further than the finger — 1.5 lines per cell is what the previous five-lines-per-notch rate
// worked out to, which is the speed this is calibrated to keep.
//
// The pair matters: drop tmux to one line without raising this and scrolling gets five times
// slower; raise this without dropping tmux and it gets five times faster. Whatever a program
// with its own mouse mode (Claude Code) does per report is its own, and this scales that too.
const TRACKPAD_GAIN = 1.5;
// A ceiling on one event's worth of reports: a page-mode delta, or a momentum spike at 3x speed,
// would otherwise emit hundreds of them in one go — the runaway this fix exists to prevent. Set
// above a screenful so nothing an ordinary gesture produces ever reaches it.
const MAX_NOTCHES_PER_EVENT = 24;

/** The banked fraction of a notch, per terminal. Wheel bursts only add up if what's left over
 *  from one event survives into the next. */
export interface WheelTicker {
  residual: number;
}

export const createWheelTicker = (): WheelTicker => ({ residual: 0 });

export interface WheelDelta {
  deltaY: number;
  deltaMode: number;
}

// `cellHeightPx <= 0` means the terminal isn't laid out yet, so pixels can't be converted to
// lines. That falls back to the old one-event-one-notch behaviour rather than to silence: a
// scroll that does nothing is worse than one that moves too far.
function linesScrolled(ev: WheelDelta, cellHeightPx: number, rows: number): number {
  if (ev.deltaMode === DOM_DELTA_PAGE) return ev.deltaY * rows;
  if (ev.deltaMode === DOM_DELTA_LINE) return ev.deltaY;
  // Anything else is pixels — DOM_DELTA_PIXEL is the only mode left, and a source that reports
  // no mode at all is treated as one rather than as no motion, which would drop the event.
  if (cellHeightPx <= 0) return Math.sign(ev.deltaY);
  const lines = ev.deltaY / cellHeightPx;
  return Math.abs(ev.deltaY) < TRACKPAD_PIXEL_DELTA ? lines * TRACKPAD_GAIN : lines;
}

/** How many wheel notches this event is worth, signed (negative = up). Fractions are banked in
 *  `ticker` until they add up to a whole notch, so a burst of tiny trackpad deltas scrolls once
 *  rather than once per event. `speed` is the user's multiplier (1 = xterm's own rate). */
export function wheelNotches(ticker: WheelTicker, ev: WheelDelta, cellHeightPx: number, rows: number, speed: number): number {
  const lines = linesScrolled(ev, cellHeightPx, rows) * speed;
  if (!Number.isFinite(lines) || lines === 0) return 0;
  // A reversal starts fresh: the fraction banked going down is not credit towards going up, and
  // spending it there would make the first flick back overshoot.
  if (Math.sign(lines) !== Math.sign(ticker.residual)) ticker.residual = 0;
  ticker.residual += lines;
  const notches = Math.trunc(ticker.residual);
  ticker.residual -= notches;
  return Math.max(-MAX_NOTCHES_PER_EVENT, Math.min(MAX_NOTCHES_PER_EVENT, notches));
}

/** The press/release pair for a main-button click on a 1-based cell. Both are sent because
 *  which of the two a TUI acts on is its own choice — a real terminal delivers both. */
export function clickReportSequences(col: number, row: number): [string, string] {
  return [sgrReport(MAIN_BUTTON, col, row), sgrReport(MAIN_BUTTON, col, row, true)];
}

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

export interface GridCell {
  col: number;
  row: number;
}

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 1), max);

/** The 1-based cell under a pointer position, clamped to the grid. xterm 6 exposes no
 *  pixel-to-cell mapping, so the cell size comes from the screen element's own box. */
export function cellFromPoint(rect: DOMRect, cols: number, rows: number, pointer: PointerPosition): GridCell {
  if (rect.width <= 0 || rect.height <= 0 || cols <= 0 || rows <= 0) return { col: 1, row: 1 };
  const col = Math.floor((pointer.clientX - rect.left) / (rect.width / cols)) + 1;
  const row = Math.floor((pointer.clientY - rect.top) / (rect.height / rows)) + 1;
  return { col: clamp(col, cols), row: clamp(row, rows) };
}

/** True when the pointer barely moved between press and release. A wider move is a drag,
 *  which stays a text selection (#729) and must not be reported as a click. */
export function isClickGesture(from: PointerPosition, to: PointerPosition): boolean {
  return Math.abs(to.clientX - from.clientX) <= CLICK_SLOP_PX && Math.abs(to.clientY - from.clientY) <= CLICK_SLOP_PX;
}
