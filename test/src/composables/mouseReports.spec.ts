import { describe, expect, it } from "vitest";

import {
  cellFromPoint,
  clearResetModes,
  clickReportSequences,
  createWheelTicker,
  isClickGesture,
  recordSwallowedModes,
  wantsMouseReports,
  wheelNotches,
  wheelReportSequence,
} from "../../../src/composables/mouseReports";

// Claude Code's actual request: drag tracking + SGR encoding in one SET.
const CLAUDE_SET: (number | number[])[] = [1002, 1006];

describe("recordSwallowedModes / clearResetModes", () => {
  it("remembers a swallowed set and forgets it on reset", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, CLAUDE_SET);
    expect(wantsMouseReports(active)).toBe(true);
    clearResetModes(active, CLAUDE_SET);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("reads the mode from a sub-parameter param", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, [[1000, 4], 1006]);
    expect(wantsMouseReports(active)).toBe(true);
  });

  it("keeps wanting mouse reports while any tracking mode is still set", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, [1000, 1002, 1006]);
    clearResetModes(active, [1002]);
    expect(wantsMouseReports(active)).toBe(true);
    clearResetModes(active, [1000]);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("ignores a reset for a mode that was never recorded", () => {
    const active = new Set<number>();
    clearResetModes(active, [1002, 1006]);
    expect(active.size).toBe(0);
  });
});

describe("wantsMouseReports", () => {
  it("requires the SGR encoding: tracking alone is not enough", () => {
    const active = new Set([1002]);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("requires a tracking mode: SGR alone is not enough", () => {
    const active = new Set([1006]);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("is false for an empty record and for unrelated modes", () => {
    expect(wantsMouseReports(new Set())).toBe(false);
    expect(wantsMouseReports(new Set([25, 1049]))).toBe(false);
  });

  it("accepts every wheel-capable tracking mode with SGR", () => {
    [1000, 1001, 1002, 1003].forEach((mode) => {
      expect(wantsMouseReports(new Set([mode, 1006]))).toBe(true);
    });
  });
});

describe("wheelReportSequence", () => {
  it("encodes wheel-up as button 64 and wheel-down as 65", () => {
    expect(wheelReportSequence(-1, 1, 1)).toBe("\x1b[<64;1;1M");
    expect(wheelReportSequence(120, 1, 1)).toBe("\x1b[<65;1;1M");
  });

  it("embeds the cell coordinates", () => {
    expect(wheelReportSequence(3, 12, 40)).toBe("\x1b[<65;12;40M");
  });

  it("returns null when there is no vertical motion", () => {
    expect(wheelReportSequence(0, 1, 1)).toBeNull();
  });
});

describe("clickReportSequences", () => {
  it("sends the main button as a press/release pair on the same cell", () => {
    expect(clickReportSequences(12, 5)).toEqual(["\x1b[<0;12;5M", "\x1b[<0;12;5m"]);
  });
});

// An 80x20 grid drawn at (100, 50), so each cell is 10px wide and 20px tall — the arithmetic
// stays readable and every boundary below is exact.
const GRID_RECT = new DOMRect(100, 50, 800, 400);
const COLS = 80;
const ROWS = 20;
const at = (clientX: number, clientY: number) => ({ clientX, clientY });

describe("cellFromPoint", () => {
  it("numbers cells from 1, not 0", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(100, 50))).toEqual({ col: 1, row: 1 });
  });

  it("keeps the last pixel of a cell inside it, and the next pixel in the next cell", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(109, 69))).toEqual({ col: 1, row: 1 });
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(110, 70))).toEqual({ col: 2, row: 2 });
  });

  it("maps an interior point to its cell", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(455, 253))).toEqual({ col: 36, row: 11 });
  });

  it("clamps a pointer that left the grid to the edge cells", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(-500, -500))).toEqual({ col: 1, row: 1 });
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(5000, 5000))).toEqual({ col: COLS, row: ROWS });
  });

  // An unlaid-out (or hidden) terminal measures zero; dividing by it would report NaN cells.
  it("falls back to the top-left cell when the element has no box", () => {
    expect(cellFromPoint(new DOMRect(0, 0, 0, 0), COLS, ROWS, at(42, 42))).toEqual({ col: 1, row: 1 });
  });
});

describe("isClickGesture", () => {
  it("accepts a press and release that did not move", () => {
    expect(isClickGesture(at(200, 100), at(200, 100))).toBe(true);
  });

  it("tolerates the drift of an ordinary click, in either direction", () => {
    expect(isClickGesture(at(200, 100), at(203, 97))).toBe(true);
  });

  it("rejects a drag — that is a text selection, not a click", () => {
    expect(isClickGesture(at(200, 100), at(204, 100))).toBe(false);
    expect(isClickGesture(at(200, 100), at(200, 140))).toBe(false);
  });
});

describe("wheelNotches", () => {
  const CELL_HEIGHT_PX = 20;
  const ROWS = 24;
  const PIXEL = 0;
  const LINE = 1;
  const PAGE = 2;
  // One swipe's worth of events through one ticker, at the default speed.
  const swipe = (deltas: number[], speed = 1, deltaMode = PIXEL): number[] => {
    const ticker = createWheelTicker();
    return deltas.map((deltaY) => wheelNotches(ticker, { deltaY, deltaMode }, CELL_HEIGHT_PX, ROWS, speed));
  };

  it("converts a pixel delta to whole cells of movement", () => {
    expect(swipe([120])).toEqual([6]);
  });

  it("signs the notches: negative is up", () => {
    expect(swipe([-120])).toEqual([-6]);
  });

  // The heart of #978: a macOS trackpad's per-event delta is a couple of pixels. Without the
  // banking each of these was a full notch — a swipe worth dozens of them.
  it("banks tiny trackpad deltas until they add up to a notch", () => {
    expect(swipe([2, 2, 2, 2, 2])).toEqual([0, 0, 0, 0, 0]); // 0.15 notches each
    expect(swipe(Array(20).fill(2)).reduce((a, b) => a + b, 0)).toBe(3);
  });

  // The swipe gain (#978), pinned as a rate: a cell of finger travel is worth 1.5 notches, and
  // tmux's copy-mode is bound to one line per notch — so text moves 1.5 lines per cell of finger.
  // Change one without the other and the scroll speed changes, not just its smoothness.
  it("is worth 1.5 notches per cell of finger travel on a trackpad", () => {
    expect(swipe(Array(10).fill(CELL_HEIGHT_PX / 10)).reduce((a, b) => a + b, 0)).toBe(1); // 1 cell -> 1.5, one paid
    expect(swipe(Array(20).fill(CELL_HEIGHT_PX / 10)).reduce((a, b) => a + b, 0)).toBe(3); // 2 cells -> 3
  });

  it("carries the leftover fraction into the next event", () => {
    expect(swipe([90, 90])).toEqual([4, 5]); // 4.5 cells then 4.5: 4 banked 0.5, then 5.0
  });

  it("drops the bank when the direction reverses", () => {
    // 2.9 cells down banks 0.9; the flick back is 5.5 cells up. Spending that 0.9 against it
    // would report only 4 — the gesture ending short of where it started.
    expect(swipe([58, -110])).toEqual([2, -5]);
  });

  it("scales by the user's speed", () => {
    expect(swipe([120], 0.5)).toEqual([3]);
    expect(swipe([120], 2)).toEqual([12]);
  });

  it("takes a line-mode delta as lines, unscaled by the cell height", () => {
    expect(swipe([3], 1, LINE)).toEqual([3]);
  });

  it("takes a page-mode delta as a screenful", () => {
    expect(swipe([1], 1, PAGE)).toEqual([ROWS]);
  });

  // A momentum spike or a multi-page delta must not turn into hundreds of reports in one event.
  it("caps one event's payout", () => {
    expect(swipe([10], 1, PAGE)).toEqual([24]);
  });

  it("reports nothing for a motionless event", () => {
    expect(swipe([0])).toEqual([0]);
  });

  // An unlaid-out terminal has no cell height, so pixels can't be converted. Falling back to one
  // notch per event keeps the wheel working (the old behaviour) rather than going dead.
  it("falls back to one notch per event when the cell height is unknown", () => {
    const ticker = createWheelTicker();
    expect(wheelNotches(ticker, { deltaY: 120, deltaMode: PIXEL }, 0, ROWS, 1)).toBe(1);
    expect(wheelNotches(ticker, { deltaY: -120, deltaMode: PIXEL }, 0, ROWS, 1)).toBe(-1);
  });
});
