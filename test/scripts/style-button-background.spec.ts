// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `tailwind.css` deliberately ships without preflight, so nothing else resets a button's
// background and the BROWSER's button face shows through — a light grey no theme chose, which
// under accent ink measured 1.74:1 in nord (#1961). The reset in `style.css` is the only thing
// holding that off, and it cannot be tested where it actually fails: jsdom has no UA button face,
// so a component spec stays green whether the rule is there or not. These specs pin the two
// properties a real browser depends on instead — that the rule exists, and that it sits in a
// layer every `bg-*` utility still outranks.
const styleFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "style.css");

/** Comments stripped, so a selector named inside one is never read as a rule. */
const source = (): string => {
  const css = readFileSync(styleFile, "utf8");
  const parts: string[] = [];
  let at = 0;
  for (let open = css.indexOf("/*"); open !== -1; open = css.indexOf("/*", at)) {
    parts.push(css.slice(at, open));
    const close = css.indexOf("*/", open + 2);
    if (close === -1) return parts.join("");
    at = close + 2;
  }
  parts.push(css.slice(at));
  return parts.join("");
};

/** The body of `@layer base { … }`, so a rule's LAYER can be asserted and not just its presence. */
function baseLayer(css: string): string {
  const start = css.indexOf("@layer base {");
  if (start === -1) throw new Error(`@layer base not found in ${styleFile}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`@layer base is unterminated in ${styleFile}`);
}

/** The declarations of a bare `button { … }` rule, or null when the stylesheet has none.
 *  Scanned rather than matched: a regex for this shape is what the super-linear-regex rule
 *  refuses, and a rule boundary is a character test the scanner already has in hand. */
function bareButtonRule(css: string): string | null {
  const BOUNDARY = "{};";
  for (let at = css.indexOf("button"); at !== -1; at = css.indexOf("button", at + 1)) {
    const before = css.slice(0, at).trimEnd();
    if (before !== "" && !BOUNDARY.includes(before.slice(-1))) continue;
    const open = css.indexOf("{", at);
    if (open === -1 || css.slice(at, open).trim() !== "button") continue;
    const close = css.indexOf("}", open);
    if (close === -1) return null;
    return css.slice(open + 1, close);
  }
  return null;
}

const resetsBackground = (css: string): boolean => (bareButtonRule(css) ?? "").replace(/\s+/g, " ").includes("background-color: transparent");

describe("the button background reset", () => {
  it("exists, so no button falls back to the browser's button face", () => {
    expect(resetsBackground(baseLayer(source()))).toBe(true);
  });

  // In `base` rather than unlayered: an unlayered rule would beat every `bg-*` utility, which is
  // how the universal reset above it once killed every padding utility (its own comment says so).
  // Here that would strip the background from every button rather than only the ones with none —
  // the opposite bug, and a louder one.
  it("is inside @layer base, not unlayered", () => {
    const css = source();
    expect(resetsBackground(css.replace(baseLayer(css), ""))).toBe(false);
  });

  // Utilities must come after base for that to hold. tailwind.css declares the same order and
  // style.css restates it because it loads first; either file losing the declaration would put
  // the order back at the mercy of import order.
  it("is declared in a layer order where utilities still win", () => {
    const css = source();
    const at = css.indexOf("@layer ");
    expect(at).toBeGreaterThanOrEqual(0);
    const layers = css
      .slice(at + "@layer ".length, css.indexOf(";", at))
      .split(",")
      .map((name) => name.trim());
    expect(layers.indexOf("utilities")).toBeGreaterThan(layers.indexOf("base"));
    expect(layers).toContain("base");
  });
});
