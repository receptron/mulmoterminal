import { describe, it, expect } from "vitest";

import {
  DEFAULT_REAP_IDLE_DAYS,
  DEFAULT_REAP_INTERVAL_HOURS,
  MAX_REAP_IDLE_DAYS,
  MAX_REAP_INTERVAL_HOURS,
  reapIdleSeconds,
  reapIntervalMs,
  reapSweepEnabled,
  reapTimerEnabled,
  sanitizeReapIdleDays,
  sanitizeReapIntervalHours,
} from "../../common/sessionReap";

// The number that decides when the server ends a session on its own (#1467). A wrong value here is
// either a sweep that never runs or one that runs too eagerly, and neither announces itself.
describe("sanitizeReapIdleDays", () => {
  it("keeps a whole number of days in range", () => {
    expect(sanitizeReapIdleDays(3)).toBe(3);
    expect(sanitizeReapIdleDays(MAX_REAP_IDLE_DAYS)).toBe(MAX_REAP_IDLE_DAYS);
  });

  // Zero is the off switch, so it must survive sanitizing — it is the one value a user picks to
  // stop the behaviour entirely.
  it("keeps zero, which is off", () => {
    expect(sanitizeReapIdleDays(0)).toBe(0);
    expect(reapSweepEnabled(0)).toBe(false);
  });

  // NOT rounded: `Math.round(0.4)` is 0, and 0 is the off switch — so rounding would let a
  // fractional value disable the sweep, which is the silent-disable the fallback exists to stop
  // (CodeRabbit on #1486).
  it.each([2.6, 0.4, 6.999])("refuses the fractional %p rather than rounding it", (value) => {
    expect(sanitizeReapIdleDays(value)).toBe(DEFAULT_REAP_IDLE_DAYS);
  });

  // Falling back to the DEFAULT rather than to 0: a corrupt value silently disabling the sweep
  // looks exactly like the bug this feature fixes, and nobody would think to look here.
  it.each([-1, MAX_REAP_IDLE_DAYS + 1, Number.NaN, Number.POSITIVE_INFINITY, "7", null, undefined, {}])("falls back to the default for %p", (value) => {
    expect(sanitizeReapIdleDays(value)).toBe(DEFAULT_REAP_IDLE_DAYS);
  });
});

describe("reapIdleSeconds", () => {
  it("is the threshold the sweep compares tmux's answer against", () => {
    expect(reapIdleSeconds(1)).toBe(86_400);
    expect(reapIdleSeconds(DEFAULT_REAP_IDLE_DAYS)).toBe(7 * 86_400);
  });
});

// How often that threshold is applied (#2165). Its failure modes are the days' two, one level up: a
// value that silently disables the timer leaves a long-running server collecting sessions again,
// which is the report.
describe("sanitizeReapIntervalHours", () => {
  it("keeps a whole number of hours in range", () => {
    expect(sanitizeReapIntervalHours(1)).toBe(1);
    expect(sanitizeReapIntervalHours(MAX_REAP_INTERVAL_HOURS)).toBe(MAX_REAP_INTERVAL_HOURS);
  });

  // Zero is start-only sweeping — the behaviour before this existed, and the one value a user picks
  // to get it back.
  it("keeps zero, which is start-only", () => {
    expect(sanitizeReapIntervalHours(0)).toBe(0);
    expect(reapTimerEnabled(0)).toBe(false);
    expect(reapTimerEnabled(1)).toBe(true);
  });

  it.each([2.6, 0.4, 5.999])("refuses the fractional %p rather than rounding it", (value) => {
    expect(sanitizeReapIntervalHours(value)).toBe(DEFAULT_REAP_INTERVAL_HOURS);
  });

  it.each([-1, MAX_REAP_INTERVAL_HOURS + 1, Number.NaN, Number.POSITIVE_INFINITY, "6", null, undefined, {}])("falls back to the default for %p", (value) => {
    expect(sanitizeReapIntervalHours(value)).toBe(DEFAULT_REAP_INTERVAL_HOURS);
  });

  // On by default: the sweep's rule does not change, so a tick only moves a reaping from the next
  // restart to the next few hours. A default of 0 here would ship the reported bug.
  it("defaults to a timer that is armed", () => {
    expect(reapTimerEnabled(DEFAULT_REAP_INTERVAL_HOURS)).toBe(true);
  });
});

describe("reapIntervalMs", () => {
  it("is what the timer is armed with", () => {
    expect(reapIntervalMs(1)).toBe(3_600_000);
    expect(reapIntervalMs(DEFAULT_REAP_INTERVAL_HOURS)).toBe(6 * 3_600_000);
  });
});
