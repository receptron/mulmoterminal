import { describe, it, expect } from "vitest";
import { extractCodexRateLimits, latestRateLimitsInRollout } from "./codex-rate-limits";

// The shape below is copied from a real rollout file, not invented: Codex names its windows
// `primary` / `secondary` and only `window_minutes` says which is which.
const FIVE_HOUR_MIN = 300;
const SEVEN_DAY_MIN = 10080;
const realShape = {
  limit_id: "codex",
  limit_name: null,
  primary: { used_percent: 2.0, window_minutes: FIVE_HOUR_MIN, resets_at: 1783818175 },
  secondary: { used_percent: 1.0, window_minutes: SEVEN_DAY_MIN, resets_at: 1784358265 },
};

describe("extractCodexRateLimits", () => {
  it("maps the two windows by duration, not by position", () => {
    expect(extractCodexRateLimits(realShape)).toEqual({
      fiveHour: { usedPercentage: 2.0, resetsAt_sec: 1783818175 },
      sevenDay: { usedPercentage: 1.0, resetsAt_sec: 1784358265 },
    });
  });

  // The names carry no promise about which window is which. A plan that lists them the other way
  // round must still land in the right slots, or the gauge shows the 7d figure as the 5h one —
  // wrong in the direction that makes someone think they have room left.
  it("still maps correctly when the durations arrive in the other order", () => {
    const swapped = { primary: realShape.secondary, secondary: realShape.primary };
    expect(extractCodexRateLimits(swapped)?.fiveHour?.usedPercentage).toBe(2.0);
    expect(extractCodexRateLimits(swapped)?.sevenDay?.usedPercentage).toBe(1.0);
  });

  // A plan whose window is near but not exactly the round number should not lose it entirely.
  it("tolerates a window that is close to the round duration", () => {
    const near = { primary: { used_percent: 9, window_minutes: FIVE_HOUR_MIN - 30, resets_at: 1 } };
    expect(extractCodexRateLimits(near)?.fiveHour?.usedPercentage).toBe(9);
  });

  it("keeps a window whose sibling is unusable", () => {
    expect(extractCodexRateLimits({ primary: realShape.primary, secondary: { used_percent: "x" } })).toEqual({
      fiveHour: { usedPercentage: 2.0, resetsAt_sec: 1783818175 },
      sevenDay: null,
    });
  });

  // Null rather than zeroes: "nothing to show" and "0% used" are opposite messages, and only one
  // of them is ever true when the data is missing.
  it.each([null, undefined, {}, { primary: {} }, "nope", { primary: { window_minutes: 300 } }])("returns null for %o", (input) => {
    expect(extractCodexRateLimits(input)).toBeNull();
  });

  it("ignores a window whose duration matches neither", () => {
    expect(extractCodexRateLimits({ primary: { used_percent: 5, window_minutes: 1, resets_at: 1 } })).toBeNull();
  });

  // #1074 swapped a hand-copied `isRecord` for the shared one, which REJECTS arrays where the copy
  // accepted them. Same answer either way — pinned so the swap stays invisible.
  it.each([
    ["the payload itself is an array", [{ primary: { used_percent: 5, window_minutes: FIVE_HOUR_MIN } }]],
    ["a window is an array", { primary: [{ used_percent: 5, window_minutes: FIVE_HOUR_MIN }] }],
  ])("is null when %s", (_case, raw) => {
    expect(extractCodexRateLimits(raw)).toBeNull();
  });
});

describe("latestRateLimitsInRollout", () => {
  const line = (used: number) =>
    JSON.stringify({ type: "event", payload: { rate_limits: { primary: { used_percent: used, window_minutes: FIVE_HOUR_MIN, resets_at: 1 } } } });

  // A long session writes the object many times; the last one is the state now.
  it("reads the newest entry, not the first", () => {
    expect(latestRateLimitsInRollout([line(5), "{}", line(42)])?.fiveHour?.usedPercentage).toBe(42);
  });

  // The search looks for the KEY rather than a fixed path precisely because Codex's surrounding
  // shape has changed before — and an array on that path (a `content` list, a batch of events) is
  // one of the shapes it has to survive. Losing it would blank the gauge with nothing to see.
  it("finds the windows nested inside an array", () => {
    const nested = JSON.stringify({
      type: "event",
      payload: { content: [{ rate_limits: { primary: { used_percent: 37, window_minutes: FIVE_HOUR_MIN, resets_at: 1 } } }] },
    });
    expect(latestRateLimitsInRollout([nested])?.fiveHour?.usedPercentage).toBe(37);
  });

  // The file is appended to while we read it, so the last line can be half-written. That must cost
  // the newest reading, not the whole file.
  it("skips a truncated last line and falls back to the one before", () => {
    expect(latestRateLimitsInRollout([line(5), '{"type":"event","payload":{"rate_li'])?.fiveHour?.usedPercentage).toBe(5);
  });

  it("returns null when no line carries the windows", () => {
    expect(latestRateLimitsInRollout(['{"type":"message"}', "", "not json"])).toBeNull();
  });
});
