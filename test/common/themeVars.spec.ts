import { describe, it, expect } from "vitest";
import {
  THEME_VAR_KEYS,
  isUsableCustomThemeId,
  isBuiltinThemeId,
  isThemeIdLike,
  resolveThemeVars,
  relativeLuminance,
  normalizeHexColor,
  isLightTheme,
  termThemeFromVars,
  type ThemeVars,
} from "../../common/themeVars.js";

const full = (over: Partial<ThemeVars> = {}): ThemeVars => Object.fromEntries(THEME_VAR_KEYS.map((k) => [k, over[k] ?? "#111111"])) as ThemeVars;

const BUILTINS = {
  midnight: full({ "--bg-base": "#1a1a2e", "--accent": "#4a8cff", "--term-fg": "#e0e0e0", "--term-selection": "#3a3a5e" }),
  nord: full({ "--bg-base": "#2e3440" }),
  daylight: full({ "--bg-base": "#f4f6fb", "--term-fg": "#1b2430" }),
  solarized: full({ "--bg-base": "#fdf6e3" }),
};

describe("isUsableCustomThemeId", () => {
  it("accepts a plain lowercase id", () => {
    expect(isUsableCustomThemeId("my-dark")).toBe(true);
    expect(isUsableCustomThemeId("ocean2")).toBe(true);
  });

  // The id becomes a data-theme attribute value and is typed into a .mulmoterminal.json.
  it("refuses shapes that would not survive that round trip", () => {
    expect(isUsableCustomThemeId("My Dark")).toBe(false);
    expect(isUsableCustomThemeId("2cool")).toBe(false);
    expect(isUsableCustomThemeId("")).toBe(false);
    expect(isUsableCustomThemeId("a".repeat(33))).toBe(false);
    expect(isUsableCustomThemeId(42)).toBe(false);
  });

  // Someone reading the guide's description of Midnight has to get Midnight.
  it("refuses the built-in ids", () => {
    expect(isUsableCustomThemeId("midnight")).toBe(false);
    expect(isUsableCustomThemeId("solarized")).toBe(false);
    expect(isBuiltinThemeId("midnight")).toBe(true);
    expect(isBuiltinThemeId("my-dark")).toBe(false);
  });
});

// Codex review on #996: the client's dir-config guard claimed `value is ThemeId` (the closed set
// of four) while custom ids flowed through it, so anything downstream was free to treat a
// four-way switch as exhaustive. ThemeIdLike is the honest type for "built-in or user-defined".
describe("isThemeIdLike", () => {
  it("accepts both a built-in id and a user-defined one", () => {
    expect(isThemeIdLike("midnight")).toBe(true);
    expect(isThemeIdLike("my-dark")).toBe(true);
  });

  it("refuses a shape that could not be an id", () => {
    expect(isThemeIdLike("My Dark")).toBe(false);
    expect(isThemeIdLike(7)).toBe(false);
    expect(isThemeIdLike(null)).toBe(false);
  });
});

describe("resolveThemeVars", () => {
  it("puts the theme's own colours on top of the base it extends", () => {
    const vars = resolveThemeVars({ id: "my-dark", label: "My Dark", extends: "midnight", colors: { "--accent": "#ff8c00" } }, BUILTINS);
    expect(vars?.["--accent"]).toBe("#ff8c00");
    expect(vars?.["--bg-base"]).toBe("#1a1a2e"); // inherited
  });

  it("accepts a complete set with no base", () => {
    const vars = resolveThemeVars({ id: "solo", label: "Solo", colors: full({ "--bg-base": "#000010" }) }, BUILTINS);
    expect(vars?.["--bg-base"]).toBe("#000010");
    expect(Object.keys(vars ?? {}).sort()).toEqual([...THEME_VAR_KEYS].sort());
  });

  // Half a theme is worse than none: the gaps would keep whatever the previous theme left on
  // the element, so the result is a mix of two palettes.
  it("returns null when there is no base and a key is missing", () => {
    const partial: Partial<ThemeVars> = { ...full() };
    delete partial["--border"];
    expect(resolveThemeVars({ id: "solo", label: "Solo", colors: partial }, BUILTINS)).toBeNull();
  });
});

describe("relativeLuminance / isLightTheme", () => {
  it("classifies the built-in backgrounds the way the stylesheet does", () => {
    expect(isLightTheme(BUILTINS.midnight)).toBe(false);
    expect(isLightTheme(BUILTINS.nord)).toBe(false);
    expect(isLightTheme(BUILTINS.daylight)).toBe(true);
    expect(isLightTheme(BUILTINS.solarized)).toBe(true);
  });

  it("puts pure black and white on the expected sides", () => {
    expect(isLightTheme(full({ "--bg-base": "#000000" }))).toBe(false);
    expect(isLightTheme(full({ "--bg-base": "#ffffff" }))).toBe(true);
  });

  // Codex review on #996: the schema accepts #rgb / #rgba / #rrggbb / #rrggbbaa, so a check that
  // read only the six-digit form called `#fff` unmeasurable — and a white theme dark, which is
  // exactly the case the status-pill switch exists for.
  it("reads every hex form the config accepts", () => {
    expect(isLightTheme(full({ "--bg-base": "#fff" }))).toBe(true);
    expect(isLightTheme(full({ "--bg-base": "#000" }))).toBe(false);
    expect(isLightTheme(full({ "--bg-base": "#FFFFFF" }))).toBe(true);
    // alpha is dropped, not composited — what is behind a translucent base is unknowable here
    expect(isLightTheme(full({ "--bg-base": "#ffff" }))).toBe(true);
    expect(isLightTheme(full({ "--bg-base": "#ffffff80" }))).toBe(true);
    expect(relativeLuminance("#fff")).toBe(relativeLuminance("#ffffff"));
  });

  it("normalizes the short forms to six digits", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("#abcd")).toBe("#aabbcc");
    expect(normalizeHexColor("#a1b2c3d4")).toBe("#a1b2c3");
    expect(normalizeHexColor("rgb(0,0,0)")).toBeNull();
    expect(normalizeHexColor("#ab")).toBeNull();
  });

  it("returns null for anything that isn't a hex colour", () => {
    expect(relativeLuminance("rgb(0,0,0)")).toBeNull();
    expect(relativeLuminance("var(--x)")).toBeNull();
  });

  // A theme whose background can't be measured is treated as dark — the default the app has
  // always shipped, rather than flipping the pill colours on a guess.
  it("treats an unmeasurable background as dark", () => {
    expect(isLightTheme(full({ "--bg-base": "not-a-colour" }))).toBe(false);
  });
});

describe("termThemeFromVars", () => {
  // xterm draws on a canvas and can't read CSS variables, so the colours reach it as values.
  it("derives the canvas colours from the chrome variables", () => {
    expect(termThemeFromVars(BUILTINS.midnight)).toEqual({
      background: "#1a1a2e",
      foreground: "#e0e0e0",
      selectionBackground: "#3a3a5e",
      cursor: "#e0e0e0",
      cursorAccent: "#1a1a2e",
    });
  });

  // #2097: the glyph on the cursor block is drawn in `cursorAccent`, and xterm's default for it
  // is a flat black. Deriving the pair from the same two variables the surrounding cells use is
  // what keeps the character under the cursor as readable as its neighbours, whatever the theme
  // — including a light theme whose `extends` names a dark built-in.
  it("makes the cursor an inverted cell on a light theme", () => {
    const light = full({ "--bg-base": "#ece7dc", "--term-fg": "#2a2622" });
    const term = termThemeFromVars(light);
    expect(term.cursor).toBe("#2a2622");
    expect(term.cursorAccent).toBe("#ece7dc");
    expect(term.cursorAccent).toBe(term.background);
    expect(term.cursor).toBe(term.foreground);
  });

  // The invariant the derivation rests on, and the answer to "could this make a theme WORSE?".
  // The cursor cell is the surrounding cell with its two colours swapped, so the contrast a
  // reader gets on it is the SAME NUMBER as the contrast they get on ordinary text. A theme whose
  // cursor is illegible under this rule is a theme whose body text was already illegible — there
  // is no palette where one holds and the other does not.
  //
  // Generated rather than enumerated: the risk is a pair nobody thought to write down. The seed
  // is fixed so a failure is reproducible.
  it("gives the cursor exactly the contrast the terminal's own text has", () => {
    const contrast = (a: string, b: string): number => {
      const [la, lb] = [relativeLuminance(a) ?? 0, relativeLuminance(b) ?? 0];
      const [hi, lo] = la > lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    };
    // A small deterministic PRNG: a spec that re-randomises every run reports a different
    // failure than the one you are asked to reproduce.
    let seed = 0x2097;
    const nextByte = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >> 16) & 0xff;
    };
    const hex = () => `#${[nextByte(), nextByte(), nextByte()].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

    for (let i = 0; i < 500; i++) {
      const vars = full({ "--bg-base": hex(), "--term-fg": hex() });
      const term = termThemeFromVars(vars);
      expect(contrast(term.cursor, term.cursorAccent)).toBe(contrast(term.foreground, term.background));
    }
  });

  // The degenerate case Codex raised on #2098: a theme whose foreground equals its background.
  // The cursor goes invisible — and so does every other character, which is the point. The rule
  // does not rescue such a theme, and pinning that here stops a future "safety" fallback being
  // added on the belief that the cursor is a special case. It is not.
  it("does not rescue a theme whose text is already invisible", () => {
    const term = termThemeFromVars(full({ "--bg-base": "#808080", "--term-fg": "#808080" }));
    expect(term.cursor).toBe(term.cursorAccent);
    expect(term.foreground).toBe(term.background);
  });
});
