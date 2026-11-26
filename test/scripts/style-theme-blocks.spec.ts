// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_IDS } from "../../common/themeIds";
import { THEME_VAR_KEYS } from "../../common/themeVars";

// THEMES (the terminal palette) is pinned to THEME_IDS elsewhere, but a built-in also needs its
// `:root[data-theme]` block here with every token, or the chrome keeps the previous theme's
// colours while the terminal switches. Read as text: jsdom is not needed to see a declaration.
const styleFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "style.css");
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

function themeBlock(css: string, id: string): string | null {
  const selector = `:root[data-theme="${id}"]`;
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return open === -1 || close === -1 ? null : css.slice(open + 1, close);
}

const declares = (block: string, key: string): boolean => new RegExp(`(^|[;{\\s])${key}\\s*:`).test(block);

describe("built-in theme blocks in style.css", () => {
  const css = withoutComments(readFileSync(styleFile, "utf8"));

  it.each([...THEME_IDS])("%s has a block declaring every theme token", (id) => {
    const block = themeBlock(css, id);
    expect(block, id).not.toBeNull();
    expect(THEME_VAR_KEYS.filter((key) => !declares(block ?? "", key))).toEqual([]);
  });

  // The near miss: a block for one id must not satisfy another, and a missing key must be seen.
  it("finds nothing for an id with no block, and reports a dropped token", () => {
    expect(themeBlock(css, "no-such-theme")).toBeNull();
    expect(declares("--bg-base: #000; --bg-deep: #111;", "--bg-panel")).toBe(false);
    expect(declares("--bg-selected-hover: #000;", "--bg-selected")).toBe(false);
  });
});
