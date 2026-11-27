import { describe, it, expect } from "vitest";
import { THEMES, isThemeId } from "../../../src/composables/useTheme";
import { THEME_IDS } from "../../../common/themeIds";
import { relativeLuminance } from "../../../common/themeVars";

const MIN_TEXT_CONTRAST = 4.5;
const LUMINANCE_OFFSET = 0.05;
const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

function contrast(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  if (la === null || lb === null) return 0;
  return (Math.max(la, lb) + LUMINANCE_OFFSET) / (Math.min(la, lb) + LUMINANCE_OFFSET);
}

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

// #2097: xterm draws the character under the cursor in `cursorAccent`, defaulting to a flat
// black. A light theme's cursor is a dark block, so the default put black on dark — the one
// character you are looking at was the only unreadable one. Every theme states it, and the value
// is its own background, so the cursor cell is the inverted version of the cells beside it.
describe("every built-in states its cursor pair", () => {
  it("sets cursorAccent to the theme's own background", () => {
    for (const { id, term } of THEMES) {
      expect(term.cursorAccent, id).toBe(term.background);
      expect(term.cursor, id).toBe(term.foreground);
    }
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

describe("terminal palettes", () => {
  const isAnsiKey = (key: string): boolean => (ANSI_KEYS as readonly string[]).includes(key);

  // A light theme overrides the ANSI set because xterm's defaults assume a dark canvas; setting
  // only some of it leaves the rest on those dark-canvas defaults.
  it("sets either none or all sixteen ANSI colours", () => {
    for (const { id, term } of THEMES) {
      const set = Object.keys(term).filter(isAnsiKey);
      expect([0, ANSI_KEYS.length], id).toContain(set.length);
    }
  });

  // xterm draws SGR 30 text in `black` too, so it is held to the same bar. Midnight and Nord set no
  // ANSI colours and are judged on foreground and cursor only. KNOWN_LOW is what predated this
  // check, one colour per entry, and may only shrink.
  const KNOWN_LOW = [
    ...["red", "green", "yellow", "blue", "magenta", "cyan", "white"].map((key) => `solarized.${key}`),
    ...["brightRed", "brightYellow", "brightBlue", "brightMagenta", "brightCyan"].map((key) => `solarized.${key}`),
    "daylight.brightCyan",
  ];
  it("keeps every foreground colour at 4.5:1 or better on the terminal background", () => {
    const low = THEMES.flatMap(({ id, term }) =>
      Object.entries(term)
        .filter(([key]) => key === "foreground" || key === "cursor" || isAnsiKey(key))
        .filter(([, value]) => typeof value === "string" && contrast(value, term.background ?? "") < MIN_TEXT_CONTRAST)
        .filter(([key]) => !KNOWN_LOW.includes(`${id}.${key}`))
        .map(([key, value]) => `${id}.${key} ${value}`),
    );
    expect(low).toEqual([]);
  });
});
