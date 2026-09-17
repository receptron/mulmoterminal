import { describe, it, expect } from "vitest";
import { isPaletteColor, PALETTE_COLOR_RE, THEME_COLOR_KEYS } from "../../common/themeColors";

// The shape both sides check (#2097). The server rejects a config on it; the client re-checks the
// response before the value reaches a canvas, because a string xterm cannot parse does not fall
// back to the theme's colour — it throws, while the WHOLE theme object is being assigned.
describe("isPaletteColor", () => {
  it("accepts every form xterm takes", () => {
    ["#fff", "#ffff", "#ffffff", "#ffffffff", "#B0402A", "#b0402a80"].forEach((c) => expect(isPaletteColor(c), c).toBe(true));
  });

  it("rejects the lengths between the valid ones", () => {
    ["#ff", "#fffff", "#fffffff", "#fffffffff"].forEach((c) => expect(isPaletteColor(c), c).toBe(false));
  });

  // Whitespace is a REJECT, not something to trim away. The predicate guards a value that is
  // about to be forwarded verbatim, so accepting a string it would have to clean up first means
  // handing xterm the uncleaned one (Codex on #2098, iteration 2).
  it("rejects a colour with surrounding whitespace rather than trimming it", () => {
    expect(isPaletteColor(" #fff ")).toBe(false);
    expect(isPaletteColor("#fff\n")).toBe(false);
  });

  it("rejects anything that is not a hex literal", () => {
    ["red", "var(--accent)", "color-mix(in srgb, red, blue)", "rgb(1,2,3)", "#fff; background: url(x)", "", "fff"].forEach((c) =>
      expect(isPaletteColor(c), c).toBe(false),
    );
  });

  it("rejects non-strings", () => {
    [null, undefined, 42, {}, ["#fff"]].forEach((v) => expect(isPaletteColor(v)).toBe(false));
  });
});

describe("THEME_COLOR_KEYS", () => {
  // The vocabulary is what separates this block from a theme's `colors`, and writing a CSS
  // variable into an xterm block is the mistake that costs a whole theme entry.
  it("holds xterm ITheme names, never CSS custom properties", () => {
    THEME_COLOR_KEYS.forEach((key) => expect(key.startsWith("--"), key).toBe(false));
  });

  it("carries the cursor pair, which is the only way to colour the cursor globally", () => {
    expect(THEME_COLOR_KEYS).toContain("cursor");
    expect(THEME_COLOR_KEYS).toContain("cursorAccent");
  });

  it("exports the pattern the server schema compiles against", () => {
    expect(PALETTE_COLOR_RE.test("#b0402a")).toBe(true);
  });
});
