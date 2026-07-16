import { describe, it, expect } from "vitest";
import { extractRateLimits, statusLineConfigured, statusLineCommand } from "./statusline";

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
  });
});

describe("statusLineConfigured", () => {
  it("is false when no layer defines one — the slot is free", () => {
    expect(statusLineConfigured([""])).toBe(false);
    expect(statusLineConfigured(["   ", '{"hooks":{}}'])).toBe(false);
    expect(statusLineConfigured([])).toBe(false);
  });

  it("is true when any layer defines one (user or project)", () => {
    expect(statusLineConfigured(['{"statusLine":{"type":"command","command":"~/.claude/statusline.sh"}}'])).toBe(true);
    expect(statusLineConfigured(['{"hooks":{}}', '{"statusLine":{"type":"command","command":"x"}}'])).toBe(true);
  });

  it("treats unparseable settings as configured, so we never clobber what we can't read", () => {
    expect(statusLineConfigured(["not json{"])).toBe(true);
  });
});

describe("statusLineCommand", () => {
  it("posts stdin to /api/rate-limits tagged with the session, printing nothing", () => {
    const cmd = statusLineCommand("localhost", 34567, "abc-123");
    expect(cmd).toContain("http://localhost:34567/api/rate-limits");
    expect(cmd).toContain("-H 'x-mt-session: abc-123'");
    expect(cmd).toContain("-d @-");
    expect(cmd).toContain(">/dev/null 2>&1");
  });
});
