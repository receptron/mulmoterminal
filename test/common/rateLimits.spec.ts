import { describe, it, expect } from "vitest";
import { parseRateLimits, parseRateLimitWindow } from "../../common/rateLimits";

// The wire parser both sides run (#387). Its guards were hand-copied one-liners until #1074 moved
// them to common/isRecord.ts and common/finiteNumber.ts — the shared `isRecord` REJECTS arrays
// where the copy accepted them, so the array cases below are what pin that swap as invisible.
describe("parseRateLimitWindow", () => {
  it("keeps a fractional percentage and the epoch reset", () => {
    expect(parseRateLimitWindow({ usedPercentage: 23.5, resetsAt_sec: 1738425600 })).toEqual({ usedPercentage: 23.5, resetsAt_sec: 1738425600 });
  });

  // Absent is not zero: a gauge reading 0% when the truth is 83% is the worst thing this can do.
  it.each([
    ["a missing percentage", { resetsAt_sec: 1738425600 }],
    ["a percentage that is not a number", { usedPercentage: "23.5" }],
    ["NaN, which no gauge can render", { usedPercentage: Number.NaN }],
    ["an array", [{ usedPercentage: 23.5 }]],
    ["null", null],
  ])("is null for %s", (_case, raw) => {
    expect(parseRateLimitWindow(raw)).toBeNull();
  });

  // Only the percentage is required — a window with no known reset is still a real reading.
  it("keeps the window when only the reset is missing", () => {
    expect(parseRateLimitWindow({ usedPercentage: 0 })).toEqual({ usedPercentage: 0, resetsAt_sec: null });
  });
});

describe("parseRateLimits", () => {
  it("reads both windows", () => {
    expect(parseRateLimits({ fiveHour: { usedPercentage: 1 }, sevenDay: { usedPercentage: 2 } })).toEqual({
      fiveHour: { usedPercentage: 1, resetsAt_sec: null },
      sevenDay: { usedPercentage: 2, resetsAt_sec: null },
    });
  });

  // Null rather than a pair of nulls, so a caller can tell "nothing to show" from "0% used".
  it.each([
    ["neither window survives", { fiveHour: null, sevenDay: {} }],
    ["an array", [{ fiveHour: { usedPercentage: 1 } }]],
    ["a string", "fiveHour"],
    ["null", null],
  ])("is null when %s", (_case, raw) => {
    expect(parseRateLimits(raw)).toBeNull();
  });

  it("keeps the pair when only one window survives", () => {
    expect(parseRateLimits({ fiveHour: { usedPercentage: 7 }, sevenDay: null })).toEqual({
      fiveHour: { usedPercentage: 7, resetsAt_sec: null },
      sevenDay: null,
    });
  });
});
