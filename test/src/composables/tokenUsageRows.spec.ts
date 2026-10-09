import { describe, it, expect } from "vitest";
import { tokenUsageRows, windowLeft } from "../../../src/composables/tokenUsageRows";
import type { AccountReading } from "../../../src/composables/rateLimitGauge";

const NOW_MS = 1_800_000_000_000;
const NOW_SEC = NOW_MS / 1000;
const HOUR = 3600;

const token = (over: Partial<AccountReading> = {}): AccountReading => ({
  id: "a",
  label: "A",
  agent: "claude",
  rotation: true,
  limits: { fiveHour: { usedPercentage: 11.6, resetsAt_sec: NOW_SEC + HOUR }, sevenDay: { usedPercentage: 75, resetsAt_sec: NOW_SEC + 24 * HOUR } },
  ...over,
});

describe("windowLeft (#2919)", () => {
  it("is what is left, rounded down", () => {
    expect(windowLeft({ usedPercentage: 11.6, resetsAt_sec: NOW_SEC + HOUR }, NOW_MS)).toEqual({ leftPercent: 88, resetsAt_sec: NOW_SEC + HOUR });
  });

  it("is all of it once the reset has passed", () => {
    expect(windowLeft({ usedPercentage: 100, resetsAt_sec: NOW_SEC - 1 }, NOW_MS)).toEqual({ leftPercent: 100, resetsAt_sec: null });
  });

  it("stays within 0-100 for a reading past its ceiling or below zero", () => {
    expect(windowLeft({ usedPercentage: 104, resetsAt_sec: null }, NOW_MS).leftPercent).toBe(0);
    expect(windowLeft({ usedPercentage: -3, resetsAt_sec: null }, NOW_MS).leftPercent).toBe(100);
  });

  it("is unknown for a window that was not reported", () => {
    expect(windowLeft(null, NOW_MS)).toEqual({ leftPercent: null, resetsAt_sec: null });
  });
});

describe("tokenUsageRows (#2919)", () => {
  it("lists rotation tokens only, in order, with their address", () => {
    const rows = tokenUsageRows([token({ email: "a@example.com" }), token({ id: "acct", rotation: false }), token({ id: "b", label: "B" })], NOW_MS);
    expect(rows.map((row) => [row.id, row.email])).toEqual([
      ["a", "a@example.com"],
      ["b", null],
    ]);
    expect(rows[0]?.sevenDay.leftPercent).toBe(25);
    expect(rows[0]?.state).toBe("ok");
  });

  it.each([
    ["at-limit", { limits: null, probe: "no-report" as const, probeStall: "usage-limit" as const }],
    ["no-answer", { limits: null, probe: "no-report" as const, probeStall: "unknown" as const }],
    ["measuring", { limits: null, probe: "ok" as const }],
    ["measuring", { limits: null }],
  ])("names a row without figures %s", (state, over) => {
    expect(tokenUsageRows([token(over)], NOW_MS)[0]?.state).toBe(state);
  });

  it("carries the last-read reset times of a row at its limit, dropping those already past", () => {
    const lastLimits = {
      fiveHour: { usedPercentage: 100, resetsAt_sec: NOW_SEC - 1 },
      sevenDay: { usedPercentage: 100, resetsAt_sec: NOW_SEC + 24 * HOUR },
    };
    const atLimit = { limits: null, probe: "no-report" as const, probeStall: "usage-limit" as const, lastLimits };
    expect(tokenUsageRows([token(atLimit)], NOW_MS)[0]?.limitResets).toEqual({ fiveHour_sec: null, sevenDay_sec: NOW_SEC + 24 * HOUR });
  });

  it("has no reset times on a row that is not at its limit", () => {
    expect(tokenUsageRows([token()], NOW_MS)[0]?.limitResets).toBeNull();
  });

  it("is empty with nothing to list", () => {
    expect(tokenUsageRows([], NOW_MS)).toEqual([]);
  });
});
