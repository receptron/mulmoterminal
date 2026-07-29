import { describe, it, expect } from "vitest";

import {
  clampPaneWidth,
  clampSecondary,
  clampTerminalWidth,
  maxTerminalWidth,
  MIN_GUI,
  MIN_ROSTER,
  MIN_STRIP,
  MIN_TERMINAL,
  MIN_TERMINAL_HEIGHT,
  splitterKeySize,
  splitterKeyWidth,
  SPLITTER_STEP,
  TERMINAL_ROSTER,
  TERMINAL_STRIP,
} from "../../../src/components/splitterWidth";

const WIDE = 1600;

describe("maxTerminalWidth", () => {
  it("leaves room for the GUI panel", () => {
    expect(maxTerminalWidth(WIDE)).toBe(WIDE - MIN_GUI);
  });

  // The case worth being careful about: a window narrower than both floors together. The
  // terminal's floor wins, because a terminal below its minimum reflows xterm into garbage
  // while a squeezed GUI panel is merely cramped.
  it("never returns less than the terminal's floor, however narrow the window", () => {
    expect(maxTerminalWidth(400)).toBe(MIN_TERMINAL);
    expect(maxTerminalWidth(0)).toBe(MIN_TERMINAL);
  });
});

describe("clampTerminalWidth", () => {
  it("leaves a width that already fits alone", () => {
    expect(clampTerminalWidth(560, WIDE)).toBe(560);
  });

  it("pulls a too-small width up to the floor", () => {
    expect(clampTerminalWidth(100, WIDE)).toBe(MIN_TERMINAL);
  });

  it("pulls a too-large width down to the maximum", () => {
    expect(clampTerminalWidth(WIDE, WIDE)).toBe(WIDE - MIN_GUI);
  });

  // A saved width from a bigger screen, re-opened on a small one.
  it("re-clamps a stored width when the window is smaller than it was", () => {
    expect(clampTerminalWidth(1200, 700)).toBe(700 - MIN_GUI);
  });

  it("does not invert on a window narrower than both floors", () => {
    expect(clampTerminalWidth(500, 400)).toBe(MIN_TERMINAL);
  });
});

describe("splitterKeyWidth", () => {
  it("nudges left and right by one step", () => {
    expect(splitterKeyWidth("ArrowLeft", 560, WIDE)).toBe(560 - SPLITTER_STEP);
    expect(splitterKeyWidth("ArrowRight", 560, WIDE)).toBe(560 + SPLITTER_STEP);
  });

  it("jumps to the limits", () => {
    expect(splitterKeyWidth("Home", 560, WIDE)).toBe(MIN_TERMINAL);
    expect(splitterKeyWidth("End", 560, WIDE)).toBe(WIDE - MIN_GUI);
  });

  it("clamps a nudge at the edges rather than walking past them", () => {
    expect(splitterKeyWidth("ArrowLeft", MIN_TERMINAL, WIDE)).toBe(MIN_TERMINAL);
    expect(splitterKeyWidth("ArrowRight", WIDE - MIN_GUI, WIDE)).toBe(WIDE - MIN_GUI);
  });

  // Null is what tells the caller NOT to preventDefault. Answer a width here and the
  // separator swallows Tab and Escape whenever it has focus.
  it.each([["Tab"], ["Escape"], ["Enter"], [" "], ["ArrowUp"], ["ArrowDown"], ["a"], ["arrowleft"]])("does not claim %j", (key) => {
    expect(splitterKeyWidth(key, 560, WIDE)).toBeNull();
  });
});

// The file pane beside a zoomed grid cell stores ITS width, not the terminal's, so the same
// rule has to hold read from the other side.
describe("clampPaneWidth", () => {
  it("leaves a width alone when both sides fit", () => {
    expect(clampPaneWidth(500, 1600)).toBe(500);
  });

  it("stops the pane from pushing the terminal below its floor", () => {
    // 1000 wide: the terminal keeps MIN_TERMINAL, so the pane can have the rest.
    expect(clampPaneWidth(900, 1000)).toBe(1000 - MIN_TERMINAL);
  });

  it("gives the pane its own floor when there is room for both", () => {
    expect(clampPaneWidth(10, 1600)).toBe(MIN_GUI);
  });

  // The documented tie-break: too narrow for both floors, and the TERMINAL's wins — a terminal
  // below its minimum reflows xterm into garbage, a squeezed pane is merely cramped.
  it("surrenders the pane's floor before the terminal's", () => {
    const available = MIN_TERMINAL + 100;
    expect(clampPaneWidth(MIN_GUI, available)).toBe(100);
  });
});

// The roster and the thumbnail strip beside an enlarged cell (#1077) store their own size, like
// the file pane, so they read the same rule from the same side — only the floors differ. The
// point of sharing it is that the tie-break cannot drift between four splitters.
describe("clampSecondary with the other splitters' floors", () => {
  it("gives the roster its floor when there is room for both", () => {
    expect(clampSecondary(10, 1600, TERMINAL_ROSTER)).toBe(MIN_ROSTER);
  });

  it("stops the roster pushing the terminal below its floor", () => {
    expect(clampSecondary(900, 1000, TERMINAL_ROSTER)).toBe(1000 - MIN_TERMINAL);
  });

  // Vertically the same rule with a different floor: the terminal's HEIGHT is what must survive.
  it("stops the strip pushing the terminal below its height floor", () => {
    expect(clampSecondary(700, 800, TERMINAL_STRIP)).toBe(800 - MIN_TERMINAL_HEIGHT);
    expect(clampSecondary(10, 800, TERMINAL_STRIP)).toBe(MIN_STRIP);
  });

  it("surrenders the secondary floor before the terminal's, on both axes", () => {
    expect(clampSecondary(MIN_ROSTER, MIN_TERMINAL + 50, TERMINAL_ROSTER)).toBe(50);
    expect(clampSecondary(MIN_STRIP, MIN_TERMINAL_HEIGHT + 40, TERMINAL_STRIP)).toBe(40);
  });

  // On a space smaller than the terminal's own floor the remainder goes NEGATIVE, and a negative
  // flex-basis is not a size: the browser discards it and the panel springs back to its
  // stylesheet width — the opposite of being squeezed. Observed while dragging the roster to its
  // limit with the file pane open.
  it("never answers a negative size, however little room is left", () => {
    expect(clampSecondary(500, MIN_TERMINAL - 100, TERMINAL_ROSTER)).toBe(0);
    expect(clampSecondary(500, 0, TERMINAL_ROSTER)).toBe(0);
    expect(clampSecondary(500, MIN_TERMINAL_HEIGHT - 50, TERMINAL_STRIP)).toBe(0);
  });
});

describe("splitterKeySize", () => {
  const TALL = 900;

  // The strip is BELOW its terminal, so the axis changes but the direction does not: Up moves the
  // separator up, which shrinks the terminal.
  it("drives a horizontal separator with Up and Down", () => {
    expect(splitterKeySize("ArrowUp", 600, TALL, TERMINAL_STRIP, "vertical")).toBe(600 - SPLITTER_STEP);
    expect(splitterKeySize("ArrowDown", 600, TALL, TERMINAL_STRIP, "vertical")).toBe(600 + SPLITTER_STEP);
    // The other axis's keys are not this separator's, so it must not swallow them.
    expect(splitterKeySize("ArrowLeft", 600, TALL, TERMINAL_STRIP, "vertical")).toBeNull();
  });

  // THE case this parameter exists for. The roster lies BEFORE its terminal, so ArrowLeft moves
  // the separator left and therefore GROWS the terminal. Read it the other way and the key walks
  // the separator opposite to the pointer that just dragged it.
  it("mirrors every key when the terminal is AFTER the separator", () => {
    expect(splitterKeySize("ArrowLeft", 600, 1600, TERMINAL_ROSTER, "horizontal", "after")).toBe(600 + SPLITTER_STEP);
    expect(splitterKeySize("ArrowRight", 600, 1600, TERMINAL_ROSTER, "horizontal", "after")).toBe(600 - SPLITTER_STEP);
    // Home/End are the same statement at the limits: Home is the separator hard against the
    // start, which for a leading roster means the roster is squeezed and the terminal is widest.
    expect(splitterKeySize("Home", 600, 1600, TERMINAL_ROSTER, "horizontal", "after")).toBe(1600 - MIN_ROSTER);
    expect(splitterKeySize("End", 600, 1600, TERMINAL_ROSTER, "horizontal", "after")).toBe(MIN_TERMINAL);
  });

  it("keeps the leading-terminal reading for the panes that already had it", () => {
    expect(splitterKeySize("Home", 600, 1600, TERMINAL_ROSTER, "horizontal", "before")).toBe(MIN_TERMINAL);
    expect(splitterKeySize("End", 600, 1600, TERMINAL_ROSTER, "horizontal", "before")).toBe(1600 - MIN_ROSTER);
  });

  it("clamps a mirrored nudge at the edges too", () => {
    const widest = 1600 - MIN_ROSTER;
    expect(splitterKeySize("ArrowLeft", widest, 1600, TERMINAL_ROSTER, "horizontal", "after")).toBe(widest);
    expect(splitterKeySize("ArrowRight", MIN_TERMINAL, 1600, TERMINAL_ROSTER, "horizontal", "after")).toBe(MIN_TERMINAL);
  });

  it.each([["Tab"], ["Escape"], ["Enter"], [" "], ["a"]])("does not claim %j on either axis", (key) => {
    expect(splitterKeySize(key, 600, 1600, TERMINAL_ROSTER, "horizontal", "after")).toBeNull();
    expect(splitterKeySize(key, 600, TALL, TERMINAL_STRIP, "vertical")).toBeNull();
  });
});
