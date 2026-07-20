import { describe, it, expect } from "vitest";
import { THEMES, isThemeId } from "../../../src/composables/useTheme";
import { THEME_IDS } from "../../../common/themeIds";

describe("theme id / theme object lockstep", () => {
  // THEME_IDS (common, drives the server zod enum + the ThemeId type) and THEMES
  // (the client's palette objects) must list the same ids in the same order. If
  // they drift, the server would accept an id the client can't paint, which then
  // falls back to THEMES[0] — a silent wrong palette. This test makes that drift a
  // build failure instead.
  it("THEMES lists exactly THEME_IDS, in the same order", () => {
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
  });
});

describe("isThemeId", () => {
  it("accepts every defined theme id", () => {
    for (const { id } of THEMES) expect(isThemeId(id)).toBe(true);
  });

  it("rejects an id with no theme object, even if it is a plausible string", () => {
    expect(isThemeId("sunset")).toBe(false);
  });

  it("rejects non-strings and junk", () => {
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(42)).toBe(false);
    expect(isThemeId("")).toBe(false);
  });
});
