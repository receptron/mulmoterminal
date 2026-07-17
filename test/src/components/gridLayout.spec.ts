import { describe, it, expect } from "vitest";
import { LAYOUTS, isLayout, dims, trackStyle, layoutForCount } from "../../../src/components/../../src/components/gridLayout";

describe("gridLayout", () => {
  it("exposes the layouts smallest→largest", () => {
    expect(LAYOUTS).toEqual(["1", "2", "2x2", "3x2", "4x2", "3x3"]);
  });

  it("isLayout accepts known layouts and rejects everything else", () => {
    expect(isLayout("1")).toBe(true);
    expect(isLayout("2")).toBe(true);
    expect(isLayout("3x3")).toBe(true);
    expect(isLayout("5x5")).toBe(false);
    expect(isLayout(null)).toBe(false);
    expect(isLayout(42)).toBe(false);
  });

  it("dims returns cols/rows/cellCount", () => {
    expect(dims("1")).toEqual({ cols: 1, rows: 1, cellCount: 1 });
    expect(dims("2")).toEqual({ cols: 2, rows: 1, cellCount: 2 });
    expect(dims("2x2")).toEqual({ cols: 2, rows: 2, cellCount: 4 });
    expect(dims("3x2")).toEqual({ cols: 3, rows: 2, cellCount: 6 });
    expect(dims("4x2")).toEqual({ cols: 4, rows: 2, cellCount: 8 });
    expect(dims("3x3")).toEqual({ cols: 3, rows: 3, cellCount: 9 });
  });

  it("layoutForCount picks the smallest layout that fits", () => {
    expect(layoutForCount(1)).toBe("1");
    expect(layoutForCount(2)).toBe("2");
    expect(layoutForCount(3)).toBe("2x2");
    expect(layoutForCount(4)).toBe("2x2");
    expect(layoutForCount(5)).toBe("3x2");
    expect(layoutForCount(6)).toBe("3x2");
    expect(layoutForCount(7)).toBe("4x2");
    expect(layoutForCount(8)).toBe("4x2");
    expect(layoutForCount(9)).toBe("3x3");
  });

  it("layoutForCount clamps out-of-range counts to 1..9", () => {
    expect(layoutForCount(0)).toBe("1");
    expect(layoutForCount(-3)).toBe("1");
    expect(layoutForCount(12)).toBe("3x3");
  });

  it("trackStyle: one equal track per cell", () => {
    expect(trackStyle("3x2")).toEqual({
      gridTemplateColumns: "1fr 1fr 1fr",
      gridTemplateRows: "1fr 1fr",
      gap: "6px",
    });
    expect(trackStyle("1")).toEqual({
      gridTemplateColumns: "1fr",
      gridTemplateRows: "1fr",
      gap: "6px",
    });
    expect(trackStyle("3x3")).toEqual({
      gridTemplateColumns: "1fr 1fr 1fr",
      gridTemplateRows: "1fr 1fr 1fr",
      gap: "6px",
    });
  });

  it("trackStyle: covers every layout", () => {
    LAYOUTS.forEach((layout) => {
      const { cols, rows } = dims(layout);
      const style = trackStyle(layout);
      expect(style.gridTemplateColumns.split(" ")).toHaveLength(cols);
      expect(style.gridTemplateRows.split(" ")).toHaveLength(rows);
    });
  });
});
