import { describe, it, expect, beforeEach } from "vitest";
import { THEME_VAR_KEYS, type ThemeVars } from "../../../common/themeVars.js";
import {
  applyCustomTheme,
  clearCustomTheme,
  customTermTheme,
  setCustomThemes,
  findCustomTheme,
  readBuiltinVars,
} from "../../../src/composables/customThemes.js";

const full = (over: Partial<ThemeVars> = {}): ThemeVars => Object.fromEntries(THEME_VAR_KEYS.map((k) => [k, over[k] ?? "#111111"])) as ThemeVars;

const BUILTINS = {
  midnight: full({ "--bg-base": "#1a1a2e", "--bg-panel": "#16213e", "--accent": "#4a8cff", "--term-fg": "#e0e0e0", "--term-selection": "#3a3a5e" }),
  nord: full({ "--bg-base": "#2e3440" }),
  daylight: full({ "--bg-base": "#f4f6fb", "--term-fg": "#1b2430" }),
  solarized: full({ "--bg-base": "#fdf6e3" }),
};

const root = () => document.documentElement;

describe("applyCustomTheme", () => {
  beforeEach(() => {
    clearCustomTheme();
    root().removeAttribute("data-appearance");
  });

  it("writes every variable, taking the rest from the base it extends", () => {
    const ok = applyCustomTheme({ id: "my-dark", label: "My Dark", extends: "midnight", colors: { "--accent": "#ff8c00" } }, BUILTINS);
    expect(ok).toBe(true);
    expect(root().style.getPropertyValue("--accent")).toBe("#ff8c00");
    expect(root().style.getPropertyValue("--bg-base")).toBe("#1a1a2e");
    THEME_VAR_KEYS.forEach((key) => expect(root().style.getPropertyValue(key)).not.toBe(""));
  });

  // The status-pill rules key on this attribute (style.css). A light theme that didn't set it
  // would render the dark-background pills — saturated green on a near-white panel.
  it("marks a light background as light and a dark one as dark", () => {
    applyCustomTheme({ id: "bright", label: "Bright", extends: "daylight", colors: {} }, BUILTINS);
    expect(root().getAttribute("data-appearance")).toBe("light");
    applyCustomTheme({ id: "my-dark", label: "My Dark", extends: "midnight", colors: {} }, BUILTINS);
    expect(root().getAttribute("data-appearance")).toBe("dark");
  });

  it("refuses to paint an incomplete theme rather than leaving half of it applied", () => {
    const ok = applyCustomTheme({ id: "broken", label: "Broken", colors: { "--accent": "#ff8c00" } }, BUILTINS);
    expect(ok).toBe(false);
    expect(root().style.getPropertyValue("--accent")).toBe("");
  });

  // An inline property beats any selector, so leaving them on would keep the custom colours
  // winning over the stylesheet's block for the built-in the user just switched to.
  it("clearCustomTheme removes every variable it set", () => {
    applyCustomTheme({ id: "my-dark", label: "My Dark", extends: "midnight", colors: { "--accent": "#ff8c00" } }, BUILTINS);
    clearCustomTheme();
    THEME_VAR_KEYS.forEach((key) => expect(root().style.getPropertyValue(key)).toBe(""));
  });
});

describe("customTermTheme", () => {
  it("derives the canvas colours from the resolved variables", () => {
    const term = customTermTheme({ id: "my-dark", label: "My Dark", extends: "midnight", colors: { "--term-fg": "#fafafa" } }, BUILTINS);
    expect(term).toEqual({
      background: "#1a1a2e",
      foreground: "#fafafa",
      selectionBackground: "#3a3a5e",
      cursor: "#fafafa",
      cursorAccent: "#1a1a2e",
    });
  });

  // #2097: `term` is the theme's own statement about the canvas, so it beats what the CSS
  // variables imply — that is the whole point of having it. Without this the cursor pair could
  // only ever be the inverted cell, which is a sane default but not a choice.
  it("lets the theme's own term block win over the derived colours", () => {
    const term = customTermTheme(
      { id: "washi", label: "Washi", extends: "daylight", colors: { "--term-fg": "#2a2622" }, term: { cursor: "#b0402a", cursorAccent: "#fffdf8" } },
      BUILTINS,
    );
    expect(term?.cursor).toBe("#b0402a");
    expect(term?.cursorAccent).toBe("#fffdf8");
    // Everything it did not name still comes from the variables.
    expect(term?.foreground).toBe("#2a2622");
  });

  // The 16 ANSI colours have never been derivable — `extends` was the only way to get them, so a
  // theme wanting one different red had to fork a whole built-in. `term` reaches them too.
  it("carries an ANSI colour the theme sets outright", () => {
    const term = customTermTheme({ id: "washi", label: "Washi", extends: "daylight", colors: {}, term: { red: "#b0402a" } }, BUILTINS);
    expect(term?.red).toBe("#b0402a");
  });

  // The server validated this already; re-checking here is what keeps the two key lists one set.
  it("drops a term key xterm does not know", () => {
    const term = customTermTheme(
      { id: "washi", label: "Washi", extends: "daylight", colors: {}, term: { cursor: "#b0402a", "--accent": "#ff0000" } as Record<string, string> },
      BUILTINS,
    );
    expect(term?.cursor).toBe("#b0402a");
    expect(term).not.toHaveProperty("--accent");
  });

  it("is null when the theme can't be resolved", () => {
    expect(customTermTheme({ id: "broken", label: "Broken", colors: {} }, BUILTINS)).toBeNull();
  });
});

describe("setCustomThemes", () => {
  it("keeps well-formed entries and ignores anything else", () => {
    setCustomThemes([{ id: "my-dark", label: "My Dark", colors: {} }, null, "nope", { id: 7 }]);
    expect(findCustomTheme("my-dark")?.label).toBe("My Dark");
    expect(findCustomTheme("missing")).toBeNull();
    setCustomThemes(undefined);
    expect(findCustomTheme("my-dark")).toBeNull();
  });
});

describe("readBuiltinVars", () => {
  // Midnight's block is written `:root, :root[data-theme="midnight"]` — the fixture uses that
  // shape on purpose, because comparing the whole selectorText finds every theme except the
  // default one, and the default is what every `extends` most often names.
  //
  // The blocks are written `:root[data-theme="x"]`, which matches the document element only. A
  // probe element carrying the attribute matches nothing and inherits the ACTIVE theme's values,
  // so every id would answer with whatever is on screen — and `extends: "daylight"` while
  // Midnight is applied would produce a dark "light" theme. Caught by looking at a screenshot.
  it("reads the named theme's block even when another theme is applied", () => {
    const style = document.createElement("style");
    style.textContent = `
      :root, :root[data-theme="midnight"] { ${THEME_VAR_KEYS.map((k) => `${k}: #111111;`).join(" ")} }
      :root[data-theme="daylight"] { ${THEME_VAR_KEYS.map((k) => `${k}: #f4f6fb;`).join(" ")} }
    `;
    document.head.appendChild(style);
    document.documentElement.setAttribute("data-theme", "midnight");
    try {
      expect(readBuiltinVars("daylight")?.["--bg-elevated"]).toBe("#f4f6fb");
      expect(readBuiltinVars("midnight")?.["--bg-elevated"]).toBe("#111111");
    } finally {
      style.remove();
      document.documentElement.removeAttribute("data-theme");
    }
  });

  it("is null when the stylesheet has no such block", () => {
    expect(readBuiltinVars("nord")).toBeNull();
  });
});
