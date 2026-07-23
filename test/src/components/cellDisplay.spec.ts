import { describe, it, expect } from "vitest";

import {
  compactRelativeTime,
  compactRelativeTimeFromIso,
  formatTokens,
  inputTokensShown,
  relativeTime,
  relativeTimeFromIso,
  usageBadge,
} from "../../../src/components/cellDisplay";

const NOW = 1_700_000_000_000;
const minutesAgo = (n: number) => NOW - n * 60_000;
const secondsAgo = (n: number) => NOW - n * 1_000;
const isoMinutesAgo = (n: number) => new Date(minutesAgo(n)).toISOString();

// The user picks which session to resume by this, so an off-by-one in the units sends them
// into the wrong conversation.
describe("relativeTime", () => {
  it.each([
    [0, "just now"],
    [0.9, "just now"],
    [1, "1m ago"],
    [59, "59m ago"],
    [60, "1h ago"],
    [90, "1h ago"],
    [23 * 60, "23h ago"],
    [24 * 60, "1d ago"],
    [72 * 60, "3d ago"],
  ])("reads %s minutes ago as %s", (minutes, expected) => {
    expect(relativeTime(minutesAgo(minutes), NOW)).toBe(expected);
  });

  // Clock skew between the server's mtime and the browser must not produce "-1m ago".
  it("says just now for a timestamp slightly in the future", () => {
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("relativeTimeFromIso", () => {
  it("delegates to relativeTime for a valid ISO timestamp", () => {
    expect(relativeTimeFromIso(isoMinutesAgo(5), NOW)).toBe("5m ago");
    expect(relativeTimeFromIso(isoMinutesAgo(25 * 60), NOW)).toBe("1d ago");
  });

  // A malformed date drops the meta rather than rendering "NaNm ago".
  it.each([["not-a-date"], [""], ["2023-13-99"]])("is empty for unparseable %j", (iso) => {
    expect(relativeTimeFromIso(iso, NOW)).toBe("");
  });
});

// The bell's compact form: same floor and same "under a minute is just now" boundary as
// relativeTime, differing only in dropping the "ago" suffix. Sharing the boundary is the
// point — the bell and the grid agree on when something stops being "just now".
describe("compactRelativeTime", () => {
  // Under a minute is "just now"; the previous seconds-based cutoff let 45–59s read "0m".
  it.each([[0], [44], [59]])("reads %i seconds ago as just now", (seconds) => {
    expect(compactRelativeTime(secondsAgo(seconds), NOW)).toBe("just now");
  });

  // The boundary is exactly one minute. Moving `minutes < 1` up would flip this to "just now".
  it("becomes 1m at exactly 60 seconds", () => {
    expect(compactRelativeTime(secondsAgo(60), NOW)).toBe("1m");
  });

  // floors, never rounds: 90s is one minute, not two; 90min is one hour; 36h is one day.
  it.each([
    [secondsAgo(90), "1m"],
    [minutesAgo(5), "5m"],
    [minutesAgo(59), "59m"],
    [minutesAgo(90), "1h"],
    [minutesAgo(23 * 60), "23h"],
    [minutesAgo(36 * 60), "1d"],
    [minutesAgo(72 * 60), "3d"],
  ])("floors %s to %s", (ms, expected) => {
    expect(compactRelativeTime(ms, NOW)).toBe(expected);
  });

  // The whole reason it is a separate function: no " ago".
  it("never appends ago", () => {
    expect(compactRelativeTime(minutesAgo(5), NOW)).not.toContain("ago");
  });

  it("says just now for a future timestamp (clock skew)", () => {
    expect(compactRelativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("compactRelativeTimeFromIso", () => {
  it("delegates to compactRelativeTime for a valid ISO timestamp", () => {
    expect(compactRelativeTimeFromIso(isoMinutesAgo(5), NOW)).toBe("5m");
  });

  it.each([["not-a-date"], [""]])("is empty for unparseable %j", (iso) => {
    expect(compactRelativeTimeFromIso(iso, NOW)).toBe("");
  });
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1.0k"],
    [1500, "1.5k"],
    [9999, "10.0k"],
    [10_000, "10k"],
    [47_200, "47k"],
    [999_999, "1000k"],
    [1_000_000, "1.0M"],
    [1_500_000, "1.5M"],
  ])("shows %i as %s", (count, expected) => {
    expect(formatTokens(count)).toBe(expected);
  });
});

describe("inputTokensShown", () => {
  const usage = { inputTokens: 100, outputTokens: 7, cacheReadTokens: 2000, cacheCreationTokens: 300 };

  // The part nothing asserted: cache reads and cache CREATION are input too. Drop either and
  // a mostly-cached session reports a fraction of what it actually sent — the number a user
  // reaches for when deciding whether to /compact.
  it("counts fresh input, cache reads and cache creation together", () => {
    expect(inputTokensShown(usage)).toBe(2400);
  });

  it.each([[null], [undefined]])("is zero when there is no usage yet (%j)", (value) => {
    expect(inputTokensShown(value)).toBe(0);
  });
});

describe("usageBadge", () => {
  it("labels both directions", () => {
    expect(usageBadge({ inputTokens: 427_000, outputTokens: 1800, cacheReadTokens: 0, cacheCreationTokens: 0 }).label).toBe("⇡427k ⇣1.8k");
  });

  // A badge reading "⇡0 ⇣0" is noise on every cell that has not had a turn yet.
  it("hides itself until something has been sent", () => {
    expect(usageBadge({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }).show).toBe(false);
    expect(usageBadge(null).show).toBe(false);
  });

  it("shows as soon as either direction is non-zero", () => {
    expect(usageBadge({ inputTokens: 0, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }).show).toBe(true);
    expect(usageBadge({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1, cacheCreationTokens: 0 }).show).toBe(true);
  });
});
