import { describe, it, expect } from "vitest";

import { clampTerminalWidth, maxTerminalWidth, MIN_GUI, MIN_TERMINAL, splitterKeyWidth, SPLITTER_STEP } from "../../../src/components/splitterWidth";

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
