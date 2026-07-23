import { describe, it, expect } from "vitest";
import { median } from "../../common/median.js";

describe("median", () => {
  it("returns null for an empty array", () => {
    expect(median([])).toBeNull();
  });

  it("returns the sole value for a single element", () => {
    expect(median([7])).toBe(7);
  });

  // The bug this file guards: an even count has two middle values, and the median is their
  // average — not the upper one (20, which the old floor(n/2) index returned).
  it("averages the two middle values for an even count", () => {
    expect(median([2, 20])).toBe(11);
  });

  it("takes the middle value for an odd count", () => {
    expect(median([1, 2, 20])).toBe(2);
  });

  it("sorts unsorted input before measuring", () => {
    expect(median([20, 1, 2])).toBe(2);
    expect(median([20, 2])).toBe(11);
  });

  it("handles negative values", () => {
    expect(median([-5, -1, -3])).toBe(-3);
    expect(median([-4, -2])).toBe(-3);
  });

  it("keeps duplicates in the count", () => {
    expect(median([5, 5, 5, 5])).toBe(5);
  });

  it("returns a fractional median when the two middle values do not average to an integer", () => {
    expect(median([11, 12])).toBe(11.5);
  });

  it("does not mutate the caller's array", () => {
    const input = [20, 1, 2];
    median(input);
    expect(input).toEqual([20, 1, 2]);
  });
});
