// @vitest-environment node
// The full-screen screens start at --screen-top, which style.css lowers while the screen tabs are up,
// so the strip never covers a screen's top. A root left at top-10 would sit under the strip.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relative: string): string => readFileSync(path.join(process.cwd(), relative), "utf8");

const ROOTS = [
  "FullScreenOverlay.vue",
  "WikiBrowseOverlay.vue",
  "AccountingOverlay.vue",
  "CollectionsBrowseOverlay.vue",
  "FilesOverlay.vue",
  "GithubBoardOverlay.vue",
  "GithubOverlay.vue",
  "blueprints/BlueprintsOverlay.vue",
];

describe("--screen-top", () => {
  it("is set under the toolbar, and lower while the screen tabs are up", () => {
    const css = read("src/style.css");
    expect(css).toMatch(/:root \{\s*--screen-top: 2\.5rem;/);
    expect(css).toMatch(/:root:has\(\[data-screen-tabs\]\) \{\s*--screen-top: 4\.5rem;/);
  });

  it.each(ROOTS)("%s starts there", (file) => {
    const source = read(path.join("src/components", file));
    expect(source).toContain("top-(--screen-top)");
    expect(source).not.toContain("inset-x-0 top-10");
  });
});
