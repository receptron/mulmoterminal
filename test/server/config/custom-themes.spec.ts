// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sanitizeCustomThemes, toPublicAppConfig, emptyConfig, mergeConfigUpdate } from "../../../server/config/app-config";
import { THEME_VAR_KEYS } from "../../../common/themeVars";

const theme = (over: Record<string, unknown> = {}) => ({
  id: "my-dark",
  label: "My Dark",
  extends: "midnight",
  colors: { "--accent": "#ff8c00" },
  ...over,
});

describe("sanitizeCustomThemes", () => {
  it("keeps a well-formed theme", () => {
    expect(sanitizeCustomThemes([theme()])).toEqual([theme()]);
  });

  it("keeps a theme with no base when it sets every colour", () => {
    const complete = theme({ id: "solo", extends: undefined, colors: Object.fromEntries(THEME_VAR_KEYS.map((k) => [k, "#101820"])) });
    expect(sanitizeCustomThemes([complete])).toHaveLength(1);
  });

  // Codex review on #996: this survived sanitization and appeared in the picker, but could not be
  // resolved — so choosing it fell back to the default and reported "not defined" about a theme
  // that is defined. An entry that cannot be painted has no business being offered.
  it("drops a theme with no base and only some colours", () => {
    const partial = theme({ id: "solo", extends: undefined, colors: { "--bg-base": "#000010", "--text": "#ffffff" } });
    expect(sanitizeCustomThemes([partial])).toEqual([]);
  });

  // Someone reading the guide's description of Midnight has to get Midnight.
  it("drops an entry that shadows a built-in id", () => {
    expect(sanitizeCustomThemes([theme({ id: "midnight" })])).toEqual([]);
    expect(sanitizeCustomThemes([theme({ id: "solarized" })])).toEqual([]);
  });

  // The values are injected into CSS custom properties, so this check is load-bearing.
  it("drops a theme whose colour is not a hex value", () => {
    expect(sanitizeCustomThemes([theme({ colors: { "--accent": "red; background: url(x)" } })])).toEqual([]);
    expect(sanitizeCustomThemes([theme({ colors: { "--accent": "var(--x)" } })])).toEqual([]);
  });

  it("drops a key that is not a theme variable", () => {
    expect(sanitizeCustomThemes([theme({ colors: { "--not-a-var": "#ff8c00" } })])).toEqual([]);
  });

  it("drops a malformed id and an unusable base", () => {
    expect(sanitizeCustomThemes([theme({ id: "My Dark" })])).toEqual([]);
    expect(sanitizeCustomThemes([theme({ extends: "nope" })])).toEqual([]);
  });

  it("keeps the first of two entries sharing an id, and survives junk", () => {
    const dup = sanitizeCustomThemes([theme(), theme({ label: "Second" })]);
    expect(dup).toHaveLength(1);
    expect(dup[0].label).toBe("My Dark");
    expect(sanitizeCustomThemes("nope")).toEqual([]);
    expect(sanitizeCustomThemes([null, 7, {}])).toEqual([]);
  });
});

// #2097: the cursor pair could only be set per directory, so the same `.mulmoterminal.json` had
// to be dropped into every project to get one cursor colour. `term` puts it on the theme.
describe("sanitizeCustomThemes: the term block", () => {
  it("keeps the xterm keys a directory's colors block also takes", () => {
    const withTerm = theme({ term: { cursor: "#b0402a", cursorAccent: "#fffdf8", red: "#c05f00" } });
    expect(sanitizeCustomThemes([withTerm])[0].term).toEqual({ cursor: "#b0402a", cursorAccent: "#fffdf8", red: "#c05f00" });
  });

  // The whole entry goes, exactly as it does for a bad key in `colors`: a theme that is half what
  // was written would be harder to diagnose than one that is plainly absent, and an absent entry
  // is what the Directory-settings panel's "dropped" list is there to report. A CSS variable put
  // in `term` is the mistake this catches — the two blocks take different vocabularies.
  it("drops the whole theme when term names something that is not an xterm colour", () => {
    expect(sanitizeCustomThemes([theme({ term: { cursor: "#b0402a", "--accent": "#ff0000" } })])).toEqual([]);
  });

  // Same rule as `colors`: a value that escaped the hex shape has no business reaching a palette.
  it("drops a theme whose term value is not a hex literal", () => {
    expect(sanitizeCustomThemes([theme({ term: { cursor: "red; background: url(x)" } })])).toEqual([]);
  });

  it("leaves a theme without one alone", () => {
    expect(sanitizeCustomThemes([theme()])[0].term).toBeUndefined();
  });
});

describe("themes survive the write/read round trip", () => {
  // toPublicAppConfig is both the API response and what gets persisted, while sanitizeAppConfig
  // reads the file back. A key named differently on the two sides would drop every theme on the
  // next start — silently, and only for the user who had defined one.
  it("uses the same key on the way out as the loader reads on the way in", () => {
    const config = { ...emptyConfig(), themes: sanitizeCustomThemes([theme({ term: { cursor: "#b0402a" } })]) };
    const persisted = toPublicAppConfig(config);
    expect(persisted.themes).toHaveLength(1);
    expect(sanitizeCustomThemes((persisted as unknown as Record<string, unknown>).themes)).toEqual(config.themes);
  });

  it("keeps existing themes when a config update doesn't mention them", () => {
    const base = { ...emptyConfig(), themes: sanitizeCustomThemes([theme()]) };
    expect(mergeConfigUpdate(base, { soundFile: null }).themes).toEqual(base.themes);
  });

  it("replaces them when the update does mention them", () => {
    const base = { ...emptyConfig(), themes: sanitizeCustomThemes([theme()]) };
    expect(mergeConfigUpdate(base, { themes: [] }).themes).toEqual([]);
  });
});
