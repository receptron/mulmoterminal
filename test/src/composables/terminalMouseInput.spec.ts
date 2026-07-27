// The pure rules have their own spec; what is pinned here is the wiring that actually makes a
// TUI's click targets work (#845): the REAL guardMouseClicks on a REAL xterm, with the #729
// tracking swallow in place, turning a click on the screen element into the SGR report the app
// asked for — and staying quiet in every case the swallow exists to protect. Asserting the rules
// alone would pass just as happily with the listeners on the wrong element or the wrong gate.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { Terminal } from "@xterm/xterm";
import { guardMouseClicks, guardMouseWheel } from "../../../src/composables/terminalMouseInput";
import { recordSwallowedModes } from "../../../src/composables/mouseReports";
import { swallowsMouseTracking } from "../../../src/composables/mouseTrackingModes";

// xterm's Terminal.open() reaches for browser APIs jsdom omits; stub the few it needs.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const COLS = 80;
const ROWS = 24;
const CELL_WIDTH_PX = 10;
const CELL_HEIGHT_PX = 20;
const LINK_HOVER_CLASS = "xterm-cursor-pointer";
const SECONDARY_BUTTON = 2;
const ALT_BUFFER_ON = "\x1b[?1049h";
const ALT_BUFFER_OFF = "\x1b[?1049l";
const CLAUDE_TRACKING_REQUEST = "\x1b[?1002;1006h";

const write = (term: Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));

const openTerminals: Terminal[] = [];

interface Wired {
  term: Terminal;
  screen: HTMLElement;
  sent: string[];
}

// A terminal wired the way ensure() wires one: the #729 parser swallow, then the click guard
// after open(). jsdom lays nothing out, so the screen element is given the grid's real geometry.
async function openWiredTerminal(options: { tracked?: boolean; scrollSpeed?: number } = {}): Promise<Wired> {
  const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  openTerminals.push(term);
  const swallowedMouseModes = new Set<number>();
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    const swallowed = swallowsMouseTracking(params);
    if (swallowed) recordSwallowedModes(swallowedMouseModes, params);
    return swallowed;
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  term.open(host);
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) throw new Error("xterm did not create .xterm-screen — the click guard has nothing to bind to");
  screen.getBoundingClientRect = () => new DOMRect(0, 0, COLS * CELL_WIDTH_PX, ROWS * CELL_HEIGHT_PX);
  guardMouseWheel(term, swallowedMouseModes, () => options.scrollSpeed ?? 1);
  guardMouseClicks(term, swallowedMouseModes);
  const sent: string[] = [];
  term.onData((data) => sent.push(data));
  await write(term, ALT_BUFFER_ON);
  if (options.tracked !== false) await write(term, CLAUDE_TRACKING_REQUEST);
  return { term, screen, sent };
}

const mouse = (screen: HTMLElement, type: "mousedown" | "mouseup", clientX: number, clientY: number, button = 0) =>
  screen.dispatchEvent(new MouseEvent(type, { clientX, clientY, button, bubbles: true }));

const click = (screen: HTMLElement, clientX: number, clientY: number) => {
  mouse(screen, "mousedown", clientX, clientY);
  mouse(screen, "mouseup", clientX, clientY);
};

afterEach(() => {
  openTerminals.splice(0).forEach((term) => term.dispose());
  document.body.replaceChildren();
});

describe("guardMouseClicks on a real terminal", () => {
  // The premise of the whole fix: xterm itself sends nothing, because #729 dropped the SET.
  it("leaves xterm out of mouse mode, so any report can only be ours", async () => {
    const { term } = await openWiredTerminal();
    expect(term.modes.mouseTrackingMode).toBe("none");
  });

  it("sends a press/release pair for the clicked cell", async () => {
    const { screen, sent } = await openWiredTerminal();
    click(screen, 115, 250); // 115px / 10px + 1 = col 12; 250px / 20px + 1 = row 13
    expect(sent).toEqual(["\x1b[<0;12;13M", "\x1b[<0;12;13m"]);
  });

  it("stays silent for a drag — that is a text selection (#729)", async () => {
    const { screen, sent } = await openWiredTerminal();
    mouse(screen, "mousedown", 115, 250);
    mouse(screen, "mouseup", 315, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent while a link is under the pointer — the link owns that click", async () => {
    const { screen, sent } = await openWiredTerminal();
    screen.classList.add(LINK_HOVER_CLASS);
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent in the normal buffer, where the pointer belongs to xterm", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    await write(term, ALT_BUFFER_OFF);
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent for an app that never asked for tracking", async () => {
    const { screen, sent } = await openWiredTerminal({ tracked: false });
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent for a secondary button", async () => {
    const { screen, sent } = await openWiredTerminal();
    mouse(screen, "mousedown", 115, 250, SECONDARY_BUTTON);
    mouse(screen, "mouseup", 115, 250, SECONDARY_BUTTON);
    expect(sent).toEqual([]);
  });

  // A press that left the element is a drag, and the browser delivers its release elsewhere. The
  // press must not stay pending: the next release to land inside would be measured against it.
  it("forgets a press once the pointer leaves, so a later release reports nothing", async () => {
    const { screen, sent } = await openWiredTerminal();
    mouse(screen, "mousedown", 115, 250);
    screen.dispatchEvent(new MouseEvent("mouseleave"));
    mouse(screen, "mouseup", 115, 250);
    expect(sent).toEqual([]);
  });

  // xterm selects a word on double-click; that gesture is the user selecting text, not pressing
  // the app's button. (The first click of the pair reports — nothing is selected yet.)
  it("stays silent for a click that left a selection behind", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    await write(term, "hello world");
    term.selectLines(0, 0);
    expect(term.hasSelection()).toBe(true);
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  // The plain-click case above must not be silently riding on this same guard.
  it("leaves no selection behind for a plain click", async () => {
    const { term, screen } = await openWiredTerminal();
    click(screen, 115, 250);
    expect(term.hasSelection()).toBe(false);
  });
});

describe("guardMouseWheel on a real terminal", () => {
  // A wheel event's deltaY is in PIXELS by default (deltaMode 0), which is what both a trackpad
  // and a macOS wheel mouse send. One cell is CELL_HEIGHT_PX tall, so 120px is 6 lines.
  const wheel = (screen: HTMLElement, deltaY: number, clientX: number, clientY: number) =>
    screen.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }));

  it("reports the wheel at the cell under the pointer, not a fixed 1;1", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, 120, 115, 250); // 115px / 10px + 1 = col 12; 250px / 20px + 1 = row 13
    expect(new Set(sent)).toEqual(new Set(["\x1b[<65;12;13M"]));
  });

  it("encodes direction: up is button 64, down is 65", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, -120, 5, 10);
    expect(new Set(sent)).toEqual(new Set(["\x1b[<64;1;1M"]));
  });

  // The rate itself, which is the whole of #978: a 120px event is 6 cells of movement, so it is
  // worth 6 notches — the same distance xterm's own scrollback would have travelled.
  it("reports one notch per cell of movement, not one per event", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, 120, 115, 250);
    expect(sent).toHaveLength(6);
  });

  // The regression #978 is actually about: a macOS trackpad emits a burst of tiny deltas per
  // swipe. One report each meant a nudge scrolled a TUI dozens of lines.
  it("banks a burst of tiny trackpad deltas instead of reporting each one", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 5; i++) wheel(screen, 2, 115, 250); // 2px: 0.15 notches each
    expect(sent).toEqual([]);
  });

  // Banked, not discarded — the swipe still has to arrive, just at the speed of the gesture.
  it("pays out the banked fraction once it adds up to a whole notch", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 20; i++) wheel(screen, 2, 115, 250); // 20 x 0.15 = 3 notches
    expect(sent).toEqual(["\x1b[<65;12;13M", "\x1b[<65;12;13M", "\x1b[<65;12;13M"]);
  });

  // The banked motion must not leak back to xterm: its alt-buffer fallback is the ↑/↓ conversion
  // #737 exists to replace, so an event worth less than a notch has to be consumed, not deferred.
  it("consumes an event too small to report rather than letting the arrow fallback have it", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, 2, 115, 250);
    expect(sent).toEqual([]);
  });

  it("drops the banked fraction when the swipe reverses, so the flick back doesn't overshoot", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 5; i++) wheel(screen, 2, 115, 250); // 0.75 notches banked downwards
    wheel(screen, -4, 115, 250); // 0.3 notches up — nothing owed, the 0.75 is not credit
    expect(sent).toEqual([]);
  });

  it("scales with the user's scroll speed", async () => {
    const half = await openWiredTerminal({ scrollSpeed: 0.5 });
    wheel(half.screen, 120, 115, 250);
    expect(half.sent).toHaveLength(3);
    const double = await openWiredTerminal({ scrollSpeed: 2 });
    wheel(double.screen, 120, 115, 250);
    expect(double.sent).toHaveLength(12);
  });

  it("stays silent in the normal buffer, where the wheel is xterm's own scrollback", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    await write(term, ALT_BUFFER_OFF);
    wheel(screen, 120, 115, 250);
    expect(sent).toEqual([]);
  });

  // The bank is scoped to one stretch of tracked scrolling. A fraction left over when the app quit
  // (or the buffer went back to normal) must not sit there and pay out on the first tiny event the
  // NEXT app sees — that app would scroll from a gesture that ended before it started.
  it("forgets the banked fraction across a trip through the normal buffer", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 6; i++) wheel(screen, 2, 115, 250); // 0.9 notches banked, none paid
    expect(sent).toEqual([]);
    await write(term, ALT_BUFFER_OFF);
    wheel(screen, 2, 115, 250); // in the normal buffer: xterm's, and it empties the bank
    await write(term, ALT_BUFFER_ON);
    wheel(screen, 2, 115, 250); // 0.15 notches — on a stale 0.9 bank this would report
    expect(sent).toEqual([]);
  });

  // Not silence but deference: for an app that asked for nothing, xterm's own alt-buffer fallback
  // turns the wheel into ↓. That fallback is exactly what #737 is about — a TUI binds the arrows
  // to input history, so scrolling spun the prompt. It is only tolerable for an app that never
  // asked for the mouse; the case above shows the report replacing it for one that did.
  it("leaves xterm's arrow-key fallback alone for an app that never asked for tracking", async () => {
    const { screen, sent } = await openWiredTerminal({ tracked: false });
    wheel(screen, 120, 115, 250);
    expect(sent).toEqual(["\x1b[B"]);
  });
});
