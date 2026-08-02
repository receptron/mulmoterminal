// The Canvas's fixed-height cards are sized from the panel's MEASURED height rather than
// from `vh` (the viewport, which is not the box they live in). This pins the two decisions
// that are not obvious from the call site: padding is subtracted, and an unusably small
// measurement is refused rather than published.
import { describe, it, expect } from "vitest";
import { canvasCardHeightPx } from "../../../src/composables/useCanvasCardHeight";

describe("canvasCardHeightPx", () => {
  it("subtracts the container's vertical padding", () => {
    // clientHeight INCLUDES padding; a card sized to the raw value overflows by exactly
    // that much and shows a scrollbar it does not need.
    expect(canvasCardHeightPx(800, 24)).toBe(776);
  });

  it("keeps the full height when there is no padding", () => {
    expect(canvasCardHeightPx(640, 0)).toBe(640);
  });

  it("rounds to whole pixels", () => {
    expect(canvasCardHeightPx(800.4, 24.3)).toBe(776);
  });

  it("refuses a measurement of zero", () => {
    // A closed pane, or a grid cell parked off-screen in roster mode, measures ~0. Publishing
    // it would collapse every card to nothing until something else resized the box, so the
    // caller keeps the last good value instead.
    expect(canvasCardHeightPx(0, 24)).toBeNull();
  });

  it("refuses a measurement too small to hold a card", () => {
    expect(canvasCardHeightPx(150, 24)).toBeNull();
  });

  it("accepts the smallest usable measurement", () => {
    expect(canvasCardHeightPx(184, 24)).toBe(160);
  });

  it("refuses a non-finite measurement", () => {
    expect(canvasCardHeightPx(Number.NaN, 24)).toBeNull();
    expect(canvasCardHeightPx(800, Number.NaN)).toBeNull();
  });
});
