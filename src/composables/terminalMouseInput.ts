// The xterm-facing half of the #729 mouse-tracking swallow: the wheel (#737) and the click
// (#845) handlers that hand a swallowed app the SGR reports it asked for. The rules they apply
// (what the app wants, where the pointer is, click vs drag, the byte sequences) are pure and
// live in ./mouseReports; what is here is the wiring onto a live Terminal.
import type { Terminal } from "@xterm/xterm";
import { cellFromPoint, clickReportSequences, createWheelTicker, isClickGesture, wantsMouseReports, wheelNotches, wheelReportSequence } from "./mouseReports";
import type { GridCell, PointerPosition } from "./mouseReports";

// xterm's Linkifier marks the screen element while a link is under the pointer. That click
// already has an owner (the link's activate handler), so reporting it too would fire both.
const LINK_HOVER_CLASS = "xterm-cursor-pointer";
const MAIN_BUTTON = 0;
const TOP_LEFT_CELL: GridCell = { col: 1, row: 1 };

// The app hears the mouse only while it is the full-screen owner of the terminal AND asked for
// tracking it never got (#729). Both halves below answer to this one gate.
const reportsMouseToApp = (term: Terminal, swallowedMouseModes: ReadonlySet<number>): boolean =>
  term.buffer.active.type === "alternate" && wantsMouseReports(swallowedMouseModes);

const screenElementOf = (term: Terminal): HTMLElement | null => term.element?.querySelector(".xterm-screen") ?? null;

// Cells are measured off the screen element's own box, since xterm exposes no pixel-to-cell
// mapping. A terminal that isn't laid out yet reports the top-left cell rather than nothing:
// for the wheel, arriving matters more than the coordinate.
function cellUnderPointer(term: Terminal, pointer: PointerPosition): GridCell {
  const screen = screenElementOf(term);
  if (!screen) return TOP_LEFT_CELL;
  return cellFromPoint(screen.getBoundingClientRect(), term.cols, term.rows, pointer);
}

// xterm exposes no cell height, so it comes off the screen element's own box — the same
// measurement the cell mapping uses. 0 means "not laid out yet", which wheelNotches reads as
// "can't convert pixels to lines".
function cellHeightOf(term: Terminal): number {
  const screen = screenElementOf(term);
  if (!screen || term.rows <= 0) return 0;
  return screen.getBoundingClientRect().height / term.rows;
}

/** Wheel -> the SGR wheel reports the app asked for. Without this xterm converts the wheel into
 *  arrow keys for an alt-buffer app, which a TUI binds to input history — so scrolling spun the
 *  prompt history instead of the transcript (#737).
 *
 *  Deltas are accumulated into whole notches (see wheelNotches) rather than reported one per
 *  event: a macOS trackpad emits a burst per swipe, and one report each scrolled a TUI far
 *  faster than the same gesture scrolls the scrollback (#978). `scrollSpeed` is read per event,
 *  so changing it in Settings applies to terminals that are already open. */
export function guardMouseWheel(term: Terminal, swallowedMouseModes: ReadonlySet<number>, scrollSpeed: () => number): void {
  const ticker = createWheelTicker();
  term.attachCustomWheelEventHandler((ev) => {
    if (!reportsMouseToApp(term, swallowedMouseModes)) {
      // The bank belongs to ONE stretch of tracked scrolling. Kept across the gap, a fraction left
      // over before an app exited (or before the buffer went back to normal) would pay out on the
      // first tiny event the NEXT app sees — a scroll it didn't ask for, from a gesture that was
      // over. Nothing is lost: an unpaid fraction is by definition less than one notch.
      ticker.residual = 0;
      return true;
    }
    if (ev.deltaY === 0) return true;
    const notches = wheelNotches(ticker, ev, cellHeightOf(term), term.rows, scrollSpeed());
    // Consumed even at zero notches: this event's motion is banked, and handing the leftover
    // back to xterm would resurrect the ↑/↓ fallback #737 exists to replace.
    ev.preventDefault();
    const cell = cellUnderPointer(term, ev);
    const seq = wheelReportSequence(notches, cell.col, cell.row);
    if (seq) for (let i = 0; i < Math.abs(notches); i++) term.input(seq, false);
    return false;
  });
}

// Which gestures are the app's to hear. Everything rejected here belongs to the browser side of
// the split the swallow draws: selecting text, or following a link.
function isReportableClick(term: Terminal, screen: HTMLElement, from: PointerPosition, release: MouseEvent): boolean {
  if (release.button !== MAIN_BUTTON || !isClickGesture(from, release)) return false;
  // A gesture that left a selection behind (a double-click's word, a triple-click's line) was the
  // user selecting text, not pressing the app's button — selection wins, as it does for a drag.
  return !term.hasSelection() && !screen.classList.contains(LINK_HOVER_CLASS);
}

/** Click -> the SGR press/release pair, so a TUI's own click targets ("Jump to bottom", "1 new
 *  message") respond (#845). Only a press and release that stayed put reports: a drag is still a
 *  text selection, which is what the swallow exists to protect. Nothing is preventDefault()ed,
 *  so xterm's selection is untouched.
 *
 *  Call AFTER term.open() — `term.element` does not exist before it. The listeners live on the
 *  terminal's own DOM, so they go away with it (dispose) and survive re-parenting (attach). */
export function guardMouseClicks(term: Terminal, swallowedMouseModes: ReadonlySet<number>): void {
  const screen = screenElementOf(term);
  if (!screen) return;
  let pressedAt: PointerPosition | null = null;
  const forgetPress = (): void => {
    pressedAt = null;
  };
  screen.addEventListener("mousedown", (ev) => {
    pressedAt = ev.button === MAIN_BUTTON ? { clientX: ev.clientX, clientY: ev.clientY } : null;
  });
  // Leaving settles the gesture as a drag. Without this the press stays pending, and an unrelated
  // release landing back inside would be measured against it — reporting a click that never was.
  screen.addEventListener("mouseleave", forgetPress);
  screen.addEventListener("mouseup", (ev) => {
    const from = pressedAt;
    forgetPress();
    if (!from || !isReportableClick(term, screen, from, ev)) return;
    if (!reportsMouseToApp(term, swallowedMouseModes)) return;
    const cell = cellUnderPointer(term, ev);
    clickReportSequences(cell.col, cell.row).forEach((seq) => term.input(seq, false));
  });
}
