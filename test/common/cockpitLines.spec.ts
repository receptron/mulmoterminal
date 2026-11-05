// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sanitizeCockpitLines, DEFAULT_COCKPIT_LINES, COCKPIT_LINES_MIN, COCKPIT_LINES_MAX } from "../../common/cockpitLines";

describe("sanitizeCockpitLines", () => {
  it("keeps whole numbers inside the range", () => {
    expect(sanitizeCockpitLines({ summary: 8, prompt: 1, response: 20 })).toEqual({ summary: 8, prompt: 1, response: 20 });
  });

  // The feature is opt-in: an install that never touched config.json must render exactly as before.
  it("falls back to 2/2/3 when nothing is configured", () => {
    expect(sanitizeCockpitLines(undefined)).toEqual(DEFAULT_COCKPIT_LINES);
    expect(sanitizeCockpitLines({})).toEqual(DEFAULT_COCKPIT_LINES);
  });

  it("rejects a non-object, so a stray scalar can't blank the roster", () => {
    for (const bad of ["8", 8, null, [], [8], true]) expect(sanitizeCockpitLines(bad)).toEqual(DEFAULT_COCKPIT_LINES);
  });

  // Per field: one typo shouldn't discard the two the user set correctly.
  it("falls back only for the bad field", () => {
    expect(sanitizeCockpitLines({ summary: 6, prompt: "x", response: 4 })).toEqual({
      summary: 6,
      prompt: DEFAULT_COCKPIT_LINES.prompt,
      response: 4,
    });
  });

  it("accepts both ends of the range", () => {
    const out = sanitizeCockpitLines({ summary: COCKPIT_LINES_MIN, prompt: COCKPIT_LINES_MAX });
    expect(out.summary).toBe(COCKPIT_LINES_MIN);
    expect(out.prompt).toBe(COCKPIT_LINES_MAX);
  });

  // Clamped, not rejected: someone who wrote 50 wants "a lot of lines", and handing them the
  // default 2 gives them LESS than they had, which reads as the setting being broken.
  it("clamps a number outside the range instead of discarding it", () => {
    expect(sanitizeCockpitLines({ summary: 50, prompt: 0, response: -5 })).toEqual({
      summary: COCKPIT_LINES_MAX,
      prompt: COCKPIT_LINES_MIN,
      response: COCKPIT_LINES_MIN,
    });
  });

  // NaN/Infinity would reach the DOM as `-webkit-line-clamp: NaN`, which drops the clamp entirely.
  // Infinity is NOT clamped to the max — it is not a direction the user asked for, it is junk.
  it("rejects NaN and Infinity rather than rendering them", () => {
    expect(sanitizeCockpitLines({ summary: Number.NaN, prompt: Number.POSITIVE_INFINITY, response: Number.NEGATIVE_INFINITY })).toEqual(DEFAULT_COCKPIT_LINES);
  });

  // Rounds like normalizeFontSize / sanitizeWorklogIntervalHours, so 1.9 lands on 2 rather than
  // silently becoming the smallest possible clamp.
  it("rounds a fractional count", () => {
    expect(sanitizeCockpitLines({ summary: 4.9 }).summary).toBe(5);
    expect(sanitizeCockpitLines({ summary: 1.9 }).summary).toBe(2);
    expect(sanitizeCockpitLines({ summary: 4.2 }).summary).toBe(4);
  });

  // The defaults are handed out by reference nowhere: a caller that mutates its result must not
  // change what the next unconfigured install gets.
  it("returns a fresh object each time", () => {
    const first = sanitizeCockpitLines(undefined);
    first.summary = 99;
    expect(sanitizeCockpitLines(undefined)).toEqual(DEFAULT_COCKPIT_LINES);
    expect(DEFAULT_COCKPIT_LINES.summary).toBe(2);
  });
});
