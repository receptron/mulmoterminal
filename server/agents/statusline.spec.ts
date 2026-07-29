import { describe, it, expect } from "vitest";
import { extractRateLimits, statusLineCommand } from "./statusline";

const payload = (rateLimits: unknown) => ({ model: { display_name: "Opus" }, rate_limits: rateLimits });

describe("extractRateLimits", () => {
  it("reads both windows, keeping the fractional percentage and epoch reset", () => {
    expect(
      extractRateLimits(
        payload({
          five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
          seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
        }),
      ),
    ).toEqual({
      fiveHour: { usedPercentage: 23.5, resetsAt_sec: 1738425600 },
      sevenDay: { usedPercentage: 41.2, resetsAt_sec: 1738857600 },
    });
  });

  it("keeps a window that is present when the other is absent (they drop independently)", () => {
    expect(extractRateLimits(payload({ five_hour: { used_percentage: 10, resets_at: 1 } }))).toEqual({
      fiveHour: { usedPercentage: 10, resetsAt_sec: 1 },
      sevenDay: null,
    });
  });

  it("keeps a window whose resets_at is missing", () => {
    expect(extractRateLimits(payload({ seven_day: { used_percentage: 0 } }))).toEqual({
      fiveHour: null,
      sevenDay: { usedPercentage: 0, resetsAt_sec: null },
    });
  });

  it("is null without rate_limits — API-key billing, or before the first API response", () => {
    expect(extractRateLimits({ model: { display_name: "Opus" } })).toBeNull();
    expect(extractRateLimits(payload({}))).toBeNull();
  });

  it("drops a window whose percentage is not a finite number", () => {
    expect(extractRateLimits(payload({ five_hour: { used_percentage: null }, seven_day: { used_percentage: "41.2" } }))).toBeNull();
    expect(extractRateLimits(payload({ five_hour: { used_percentage: NaN } }))).toBeNull();
  });

  it("survives junk input", () => {
    expect(extractRateLimits(null)).toBeNull();
    expect(extractRateLimits("not json")).toBeNull();
    expect(extractRateLimits(payload("nope"))).toBeNull();
    expect(extractRateLimits(payload({ five_hour: 5 }))).toBeNull();
    // #1074 swapped a hand-copied `isRecord` for the shared one, which REJECTS arrays where the
    // copy accepted them. Same answer either way — pinned so the swap stays invisible.
    expect(extractRateLimits([])).toBeNull();
    expect(extractRateLimits(payload([{ used_percentage: 23.5 }]))).toBeNull();
  });
});

// statusLineConfigured went with the design it belonged to. #388 injected into the user's OWN
// sessions, so it had to check whether their statusLine slot was already taken and stand down if
// it was. The probe carries its own settings file that nothing else writes, so there is nothing to
// clobber — a whole class of risk that disappeared rather than being handled.

describe("statusLineCommand", () => {
  it("posts stdin to /api/rate-limits, printing nothing", () => {
    const cmd = statusLineCommand("localhost", 34567);
    expect(cmd).toContain("http://localhost:34567/api/rate-limits");
    expect(cmd).toContain("-d @-");
    expect(cmd).toContain(">/dev/null 2>&1");
  });

  // It used to send `x-mt-session`, which that route has never read. An identifier nobody checks
  // reads as a guarantee the code does not make, so it is gone rather than left as decoration.
  it("does not send an identifier the route never verifies", () => {
    expect(statusLineCommand("localhost", 34567)).not.toContain("x-mt-session");
  });
});
