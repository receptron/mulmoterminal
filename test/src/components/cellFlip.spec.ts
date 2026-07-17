import { describe, it, expect } from "vitest";
import { flipKeyframes, FLIP_MS, FLIP_EASING, shouldRefocusOnZoomChange } from "../../src/components/cellFlip.js";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe("cellFlip", () => {
  it("exposes the timing the stylesheet and the animation share", () => {
    expect(FLIP_MS).toBe(180);
    expect(FLIP_EASING).toBe("cubic-bezier(0.2, 0, 0, 1)");
  });

  it("inverts an expand: starts at the old slot, ends at identity", () => {
    // A 100x50 cell at (10, 20) grows to fill a 400x200 overlay at the origin.
    const frames = flipKeyframes(rect(10, 20, 100, 50), rect(0, 0, 400, 200));
    expect(frames).toEqual([
      { transformOrigin: "top left", transform: "translate(10px, 20px) scale(0.25, 0.25)" },
      { transformOrigin: "top left", transform: "none" },
    ]);
  });

  it("inverts a restore: the same move read backwards", () => {
    const frames = flipKeyframes(rect(0, 0, 400, 200), rect(10, 20, 100, 50));
    expect(frames).toEqual([
      { transformOrigin: "top left", transform: "translate(-10px, -20px) scale(4, 4)" },
      { transformOrigin: "top left", transform: "none" },
    ]);
  });

  it("keeps the axes independent when the aspect ratio changes", () => {
    const frames = flipKeyframes(rect(0, 0, 100, 100), rect(0, 0, 400, 200));
    expect(frames?.[0].transform).toBe("translate(0px, 0px) scale(0.25, 0.5)");
  });

  it("skips a cell that has not been laid out (zero-area destination)", () => {
    expect(flipKeyframes(rect(0, 0, 100, 50), rect(0, 0, 0, 0))).toBeNull();
    expect(flipKeyframes(rect(0, 0, 100, 50), rect(0, 0, 400, 0))).toBeNull();
    expect(flipKeyframes(rect(0, 0, 100, 50), rect(0, 0, 0, 200))).toBeNull();
  });

  it("skips a move that would be invisible", () => {
    expect(flipKeyframes(rect(0, 0, 400, 200), rect(0, 0, 400, 200))).toBeNull();
    // Sub-pixel drift and a sub-percent resize both stay under the threshold.
    expect(flipKeyframes(rect(0.4, -0.6, 400, 200), rect(0, 0, 400.5, 200.5))).toBeNull();
  });

  it("animates once any single axis crosses the threshold", () => {
    expect(flipKeyframes(rect(2, 0, 400, 200), rect(0, 0, 400, 200))).not.toBeNull();
    expect(flipKeyframes(rect(0, 2, 400, 200), rect(0, 0, 400, 200))).not.toBeNull();
    expect(flipKeyframes(rect(0, 0, 440, 200), rect(0, 0, 400, 200))).not.toBeNull();
    expect(flipKeyframes(rect(0, 0, 400, 220), rect(0, 0, 400, 200))).not.toBeNull();
  });

  it("survives a destination larger than the viewport without losing precision", () => {
    const frames = flipKeyframes(rect(-50, -50, 260, 150), rect(0, 0, 2600, 1500));
    expect(frames?.[0].transform).toBe("translate(-50px, -50px) scale(0.1, 0.1)");
  });

  describe("shouldRefocusOnZoomChange (which cell grabs focus after an expand/collapse)", () => {
    it("refocuses the cell that just became big", () => {
      expect(shouldRefocusOnZoomChange(true, true)).toBe(true);
    });
    it("refocuses the cell returning to the grid on a full collapse", () => {
      expect(shouldRefocusOnZoomChange(false, false)).toBe(true);
      expect(shouldRefocusOnZoomChange(false, undefined)).toBe(true);
    });
    it("does NOT refocus a cell that shrank because another cell became big", () => {
      expect(shouldRefocusOnZoomChange(false, true)).toBe(false);
    });
  });
});
