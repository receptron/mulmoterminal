import { describe, it, expect } from "vitest";
import { PREVIEW_THEME_PARAMS, previewThemeFromQuery, previewThemeFromVars } from "../../common/previewTheme";
import { THEME_VAR_KEYS, type ThemeVars } from "../../common/themeVars";

// #2263. The app's theme travels to the sandboxed preview on its URL and lands in its CSS, so
// only a hex colour gets through, and one bad value drops the whole theme.
const THEME = { bg: "#1a1a2e", fg: "#e6e6f0", muted: "#a0a0b8", subtle: "#232342", border: "#33335a", link: "#4a8cff" };

describe("previewThemeFromQuery", () => {
  it("reads every colour", () => {
    expect(previewThemeFromQuery({ ...THEME, path: "a.md" })).toEqual(THEME);
  });

  it.each([["#fff"], ["#ffff"], ["#ffffffff"]])("accepts the other hex spelling %s", (bg) => {
    expect(previewThemeFromQuery({ ...THEME, bg })?.bg).toBe(bg);
  });

  it.each([
    ["CSS that closes the rule", "#000;}body{display:none"],
    ["a named colour", "red"],
    ["rgb()", "rgb(0,0,0)"],
    ["a url", "url(https://example.com/x)"],
    ["surrounding whitespace", " #fff"],
    ["an array (a repeated parameter)", ["#fff", "#000"]],
    ["nothing", undefined],
  ])("drops the whole theme for %s", (_case, link) => {
    expect(previewThemeFromQuery({ ...THEME, link })).toBeNull();
  });
});

describe("previewThemeFromVars", () => {
  const isThemeVars = (value: Record<string, string>): value is ThemeVars => THEME_VAR_KEYS.every((key) => typeof value[key] === "string");
  const built: Record<string, string> = Object.fromEntries(THEME_VAR_KEYS.map((key) => [key, "#123456"]));
  if (!isThemeVars(built)) throw new Error("incomplete theme vars");
  const vars = built;

  it("takes each colour from the theme variable it names", () => {
    const theme = previewThemeFromVars({ ...vars, "--bg-base": "#010101", "--accent": "#020202" });
    expect(theme).toMatchObject({ bg: "#010101", link: "#020202", fg: "#123456" });
    expect(Object.keys(theme ?? {})).toEqual(Object.keys(PREVIEW_THEME_PARAMS));
  });

  it("gives nothing when a variable it needs is not a hex colour", () => {
    expect(previewThemeFromVars({ ...vars, "--text": "var(--x)" })).toBeNull();
  });
});
