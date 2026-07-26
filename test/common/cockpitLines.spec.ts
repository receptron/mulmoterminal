// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sanitizeCockpitLines, clampStyle, DEFAULT_COCKPIT_LINES, COCKPIT_LINES_MIN, COCKPIT_LINES_MAX } from "../../common/cockpitLines";

describe("sanitizeCockpitLines", () => {
  it("keeps whole numbers inside the range", () => {
    expect(sanitizeCockpitLines({ summary: 8, prompt: 1, response: 20 })).toEqual({ summary: 8, prompt: 1, response: 20 });
  });

  it("falls back to 2/2/3 when nothing is configured", () => {
    expect(sanitizeCockpitLines(undefined)).toEqual(DEFAULT_COCKPIT_LINES);
    expect(sanitizeCockpitLines({})).toEqual(DEFAULT_COCKPIT_LINES);
  });

  it("rejects a non-object, so a stray string can't blank the roster", () => {
    for (const bad of ["8", 8, null, [], [8]]) expect(sanitizeCockpitLines(bad)).toEqual(DEFAULT_COCKPIT_LINES);
  });

  // Per field: one typo shouldn't discard the two the user set correctly.
  it("falls back only for the bad field", () => {
    expect(sanitizeCockpitLines({ summary: 6, prompt: "x", response: 0 })).toEqual({
      summary: 6,
      prompt: DEFAULT_COCKPIT_LINES.prompt,
      response: DEFAULT_COCKPIT_LINES.response,
    });
  });

  it("rejects out-of-range values at both ends", () => {
    const out = sanitizeCockpitLines({ summary: COCKPIT_LINES_MIN - 1, prompt: COCKPIT_LINES_MAX + 1, response: -5 });
    expect(out).toEqual(DEFAULT_COCKPIT_LINES);
  });

  it("rejects NaN and Infinity rather than rendering them", () => {
    expect(sanitizeCockpitLines({ summary: Number.NaN, prompt: Number.POSITIVE_INFINITY })).toEqual(DEFAULT_COCKPIT_LINES);
  });

  it("floors a fractional count", () => {
    expect(sanitizeCockpitLines({ summary: 4.9 }).summary).toBe(4);
  });
});

describe("clampStyle", () => {
  it("clamps to the given number of lines", () => {
    expect(clampStyle(5)).toEqual({
      display: "-webkit-box",
      "-webkit-box-orient": "vertical",
      "-webkit-line-clamp": "5",
      overflow: "hidden",
    });
  });

  // The count is a runtime value, so Tailwind's line-clamp-N (which only exists for literals
  // present in the source) can't express it — the style has to carry the number as a string.
  it("renders the count as a string, which is what the DOM style property needs", () => {
    expect(clampStyle(12)["-webkit-line-clamp"]).toBe("12");
  });
});
