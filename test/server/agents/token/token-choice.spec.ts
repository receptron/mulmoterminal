// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  blockedUntil,
  burnPace,
  chooseToken,
  FIVE_HOUR_CEILING_PERCENT,
  nearLimit,
  sevenDayCeiling,
  SWITCH_AT_PERCENT,
  type TokenCandidate,
} from "../../../../server/agents/token/token-choice";
import type { RateLimits } from "../../../../common/rateLimits";

const NOW = 1_800_000_000;
const HOUR = 3600;
const DAY = 24 * HOUR;

const limits = (sevenUsed: number, sevenResetIn_sec: number | null, fiveUsed = 0, fiveResetIn_sec = 2 * HOUR): RateLimits => ({
  fiveHour: { usedPercentage: fiveUsed, resetsAt_sec: NOW + fiveResetIn_sec },
  sevenDay: { usedPercentage: sevenUsed, resetsAt_sec: sevenResetIn_sec === null ? null : NOW + sevenResetIn_sec },
});
const candidate = (id: string, readings: RateLimits | null, spentUntil_sec: number | null = null): TokenCandidate => ({ id, limits: readings, spentUntil_sec });

describe("chooseToken (#2919)", () => {
  it("returns null with no candidates", () => {
    expect(chooseToken([], NOW)).toBeNull();
  });

  it("takes the only candidate", () => {
    expect(chooseToken([candidate("a", null)], NOW)).toBe("a");
  });

  it("prefers the window that resets soon with room left over one with more room and a week to go", () => {
    // a: 40% left over 1 day = 1.67/h. b: 90% left over 6 days = 0.625/h.
    const a = candidate("a", limits(60, DAY));
    const b = candidate("b", limits(10, 6 * DAY));
    expect(chooseToken([b, a], NOW)).toBe("a");
  });

  it("prefers the emptier window when both reset at the same time", () => {
    expect(chooseToken([candidate("a", limits(70, 3 * DAY)), candidate("b", limits(20, 3 * DAY))], NOW)).toBe("b");
  });

  it("keeps config order on a tie", () => {
    expect(chooseToken([candidate("a", limits(50, 2 * DAY)), candidate("b", limits(50, 2 * DAY))], NOW)).toBe("a");
  });

  it("holds out a candidate whose 7-day window is used up", () => {
    expect(chooseToken([candidate("a", limits(100, HOUR)), candidate("b", limits(SWITCH_AT_PERCENT - 1, 6 * DAY))], NOW)).toBe("b");
  });

  it("holds out a candidate whose 5-hour window is at the ceiling", () => {
    const a = candidate("a", limits(10, HOUR, FIVE_HOUR_CEILING_PERCENT));
    const b = candidate("b", limits(80, 6 * DAY, FIVE_HOUR_CEILING_PERCENT - 1));
    expect(chooseToken([a, b], NOW)).toBe("b");
  });

  it("holds out a candidate a limit hit marked spent", () => {
    expect(chooseToken([candidate("a", limits(0, DAY), NOW + HOUR), candidate("b", limits(90, 6 * DAY))], NOW)).toBe("b");
  });

  it("lets a spent mark lapse once its time has passed", () => {
    expect(chooseToken([candidate("a", limits(0, DAY), NOW - 1), candidate("b", limits(90, 6 * DAY))], NOW)).toBe("a");
  });

  it("treats a window whose reset has passed as unused", () => {
    // a's 100% reading is from before its reset; it is empty now and resets were due.
    const a = candidate("a", limits(100, -HOUR, 100, -HOUR));
    const b = candidate("b", limits(50, 6 * DAY));
    expect(chooseToken([b, a], NOW)).toBe("a");
  });

  it("ranks an unmeasured candidate after every measured free one", () => {
    expect(chooseToken([candidate("a", null), candidate("b", limits(95, 6 * DAY))], NOW)).toBe("b");
  });

  it("ranks an unmeasured candidate before a held-out one", () => {
    expect(chooseToken([candidate("a", limits(100, DAY)), candidate("b", null)], NOW)).toBe("b");
  });

  it("ranks a candidate whose latest probe failed with the unmeasured, behind every measured free one (#3291)", () => {
    // a's stale reading — 1% of a week resetting tomorrow — would win on pace by far.
    const a: TokenCandidate = { ...candidate("a", limits(1, DAY)), probeFailed: true };
    expect(chooseToken([a, candidate("b", limits(95, 6 * DAY))], NOW)).toBe("b");
  });

  it("does not let a failed probe's stale reading put it ahead of a never-measured one (#3291)", () => {
    const a: TokenCandidate = { ...candidate("a", limits(1, DAY)), probeFailed: true };
    expect(chooseToken([candidate("b", null), a], NOW)).toBe("b");
  });

  it("still holds out a candidate whose failed probe's last reading was at its ceiling (#3291)", () => {
    const a: TokenCandidate = { ...candidate("a", limits(100, DAY)), probeFailed: true };
    expect(chooseToken([a, candidate("b", null)], NOW)).toBe("b");
  });

  it("still takes a candidate whose probe failed when it is the only free one (#3291)", () => {
    const a: TokenCandidate = { ...candidate("a", limits(1, DAY)), probeFailed: true };
    expect(chooseToken([a, candidate("b", limits(100, DAY))], NOW)).toBe("a");
  });

  it("with every candidate held out, picks the one free soonest", () => {
    const a = candidate("a", limits(100, 3 * DAY));
    const b = candidate("b", limits(100, DAY));
    const c = candidate("c", limits(10, 6 * DAY), NOW + 2 * DAY);
    expect(chooseToken([a, b, c], NOW)).toBe("b");
  });

  it("does not let a reading a minute before its reset dwarf the others", () => {
    // Floored at one hour: a has 5%/h, b 100% over 1 day = 4.17/h.
    const a = candidate("a", limits(95, 60));
    const b = candidate("b", limits(0, DAY));
    expect(chooseToken([b, a], NOW)).toBe("a");
    expect(burnPace(limits(95, 60), NOW)).toBe(5);
  });
});

describe("blockedUntil", () => {
  it("is null for a free candidate, with or without readings", () => {
    expect(blockedUntil(candidate("a", null), NOW)).toBeNull();
    expect(blockedUntil(candidate("a", limits(50, DAY)), NOW)).toBeNull();
  });

  it("is the later of two blocking windows", () => {
    expect(blockedUntil(candidate("a", limits(100, 3 * DAY, 95, HOUR)), NOW)).toBe(NOW + 3 * DAY);
  });

  it("is open-ended for a used-up window with no reset time", () => {
    expect(blockedUntil(candidate("a", limits(100, null)), NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("burnPace", () => {
  it("ranks a reading with no 7-day window as a full unused week", () => {
    expect(burnPace({ fiveHour: { usedPercentage: 10, resetsAt_sec: NOW + HOUR }, sevenDay: null }, NOW)).toBeCloseTo(100 / (7 * 24));
  });

  it("ranks a 7-day window with no reset time over a full week", () => {
    expect(burnPace(limits(30, null), NOW)).toBeCloseTo(70 / (7 * 24));
  });
});

describe("the switch line (#2919)", () => {
  it("holds out a week at the line for a new session", () => {
    expect(chooseToken([candidate("a", limits(SWITCH_AT_PERCENT, 6 * DAY)), candidate("b", limits(SWITCH_AT_PERCENT - 1, 6 * DAY))], NOW)).toBe("b");
  });

  it("nearLimit is true at the line in either window, and false just below", () => {
    expect(nearLimit(limits(SWITCH_AT_PERCENT, DAY), NOW)).toBe(true);
    expect(nearLimit(limits(0, DAY, SWITCH_AT_PERCENT), NOW)).toBe(true);
    expect(nearLimit(limits(SWITCH_AT_PERCENT - 1, DAY, SWITCH_AT_PERCENT - 1), NOW)).toBe(false);
  });

  it("nearLimit ignores a window whose reset has passed, and readings that are absent", () => {
    expect(nearLimit(limits(100, -HOUR, 100, -HOUR), NOW)).toBe(false);
    expect(nearLimit(null, NOW)).toBe(false);
  });
});

describe("spreading parallel sessions (#2926)", () => {
  const busy = (id: string, readings: RateLimits | null, liveSessions: number): TokenCandidate => ({ id, limits: readings, liveSessions });

  it("shares a subscription's pace among the sessions already on it", () => {
    // a: 15% left over 2h = 7.5/h, with 5 running → 1.25. b: 99% left over 55h = 1.8/h, none running.
    expect(chooseToken([busy("a", limits(85, 2 * HOUR), 5), busy("b", limits(1, 55 * HOUR), 0)], NOW)).toBe("b");
  });

  it("still gives the urgent window the first sessions", () => {
    expect(chooseToken([busy("a", limits(85, 2 * HOUR), 0), busy("b", limits(1, 55 * HOUR), 0)], NOW)).toBe("a");
  });

  it("spreads a burst of sessions opened before any reading moves", () => {
    const same = limits(50, 3 * DAY);
    const live: Record<string, number> = { a: 0, b: 0, c: 0 };
    const picks = Array.from({ length: 6 }, () => {
      const id = chooseToken(
        ["a", "b", "c"].map((key) => busy(key, same, live[key] ?? 0)),
        NOW,
      );
      if (id !== null) live[id] = (live[id] ?? 0) + 1;
      return id;
    });
    expect(live).toEqual({ a: 2, b: 2, c: 2 });
    expect(picks.slice(0, 3)).toEqual(["a", "b", "c"]);
  });

  it("breaks a tie between unmeasured subscriptions toward the less busy", () => {
    expect(chooseToken([busy("a", null, 2), busy("b", null, 0)], NOW)).toBe("b");
  });

  it("treats a missing count as nobody running", () => {
    expect(chooseToken([candidate("a", limits(50, DAY)), busy("b", limits(50, DAY), 1)], NOW)).toBe("a");
  });
});

describe("a weekly reserve (#3064)", () => {
  const reserved = (id: string, readings: RateLimits | null, reserveWeeklyPercent: number, spentUntil_sec: number | null = null): TokenCandidate => ({
    id,
    limits: readings,
    spentUntil_sec,
    reserveWeeklyPercent,
  });

  it("lowers the weekly ceiling to what the reserve leaves, never raising it past the switch line", () => {
    expect(sevenDayCeiling()).toBe(SWITCH_AT_PERCENT);
    expect(sevenDayCeiling(0)).toBe(SWITCH_AT_PERCENT);
    expect(sevenDayCeiling(1)).toBe(SWITCH_AT_PERCENT);
    expect(sevenDayCeiling(5)).toBe(95);
    expect(sevenDayCeiling(50)).toBe(50);
  });

  it("holds a candidate out once its week reaches the reserve, and not before", () => {
    expect(blockedUntil(reserved("a", limits(94.9, DAY), 5), NOW)).toBeNull();
    expect(blockedUntil(reserved("a", limits(95, DAY), 5), NOW)).toBe(NOW + DAY);
  });

  it("does not hold out on a reserve the window has reset past", () => {
    const resetPassed: RateLimits = { fiveHour: null, sevenDay: { usedPercentage: 99, resetsAt_sec: NOW - 1 } };
    expect(blockedUntil(reserved("a", resetPassed, 5), NOW)).toBeNull();
  });

  it("skips the reserved candidate for another below its line", () => {
    expect(chooseToken([reserved("a", limits(96, HOUR), 5), candidate("b", limits(90, 6 * DAY))], NOW)).toBe("b");
  });

  it("ranks by the room above the reserve", () => {
    // a: 60% used, 40% reserved -> nothing above the line; b: 60% used, no reserve.
    expect(burnPace(limits(60, DAY), NOW, 40)).toBe(0);
    expect(chooseToken([reserved("a", limits(30, DAY), 40), candidate("b", limits(50, DAY))], NOW)).toBe("b");
    expect(chooseToken([reserved("a", limits(30, DAY), 5), candidate("b", limits(50, DAY))], NOW)).toBe("a");
  });

  it("never falls back onto a candidate down to its reserve, even when it frees soonest", () => {
    const a = reserved("a", limits(96, HOUR), 5);
    const b = candidate("b", limits(SWITCH_AT_PERCENT, 3 * DAY));
    expect(chooseToken([a, b], NOW)).toBe("b");
  });

  it("chooses nothing when every candidate is down to its reserve", () => {
    expect(chooseToken([reserved("a", limits(96, HOUR), 5), reserved("b", limits(91, DAY), 10)], NOW)).toBeNull();
  });

  it("still falls back onto a reserved candidate held out for another reason", () => {
    const a = reserved("a", limits(10, DAY, FIVE_HOUR_CEILING_PERCENT, HOUR), 5);
    const b = candidate("b", limits(SWITCH_AT_PERCENT, 3 * DAY));
    expect(chooseToken([a, b], NOW)).toBe("a");
  });

  it("moves a running session at the reserve's line", () => {
    expect(nearLimit(limits(94, DAY), NOW, 5)).toBe(false);
    expect(nearLimit(limits(95, DAY), NOW, 5)).toBe(true);
    expect(nearLimit(limits(95, DAY), NOW)).toBe(false);
  });
});
