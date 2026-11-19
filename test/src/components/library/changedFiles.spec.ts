// The changed files in the reader (#3330): which diffs a file offers, and how its path reads.
import { describe, it, expect } from "vitest";
import { diffSteps, shownPath } from "../../../../src/components/library/changedFiles";
import type { LibraryTrackedFile } from "../../../../common/libraryFiles";

const file = (versions: number[], filePath: string | null = "/w/app/src/a.ts", trackingPath = "src/a.ts"): LibraryTrackedFile => ({
  trackingPath,
  path: filePath,
  versions: versions.map((version) => ({ version, at: null, exists: true })),
});

describe("diffSteps", () => {
  it("offers the whole change first, then each turn's, the last ending at now", () => {
    expect(diffSteps(file([1, 2, 4])).map((step) => [step.key, step.from, step.to])).toEqual([
      ["whole", 1, "now"],
      ["1-2", 1, 2],
      ["2-4", 2, 4],
      ["4-now", 4, "now"],
    ]);
  });

  it("offers only the whole for one version, and nothing for none", () => {
    expect(diffSteps(file([2]))).toEqual([{ key: "whole", from: 2, to: "now" }]);
    expect(diffSteps(file([]))).toEqual([]);
  });
});

describe("shownPath", () => {
  it.each([
    ["/w/app/src/a.ts", "/w/app", "src/a.ts"],
    ["/w/app2/a.ts", "/w/app", "…/app2/a.ts"],
    ["/Users/me/.claude/projects/x/memory/note.md", "/w/app", "…/memory/note.md"],
    ["/a.ts", "/w/app", "/a.ts"],
    ["C:\\w\\app\\a.ts", "C:\\w\\app", "a.ts"],
    ["C:\\other\\dir\\a.ts", "C:\\w\\app", "…/dir/a.ts"],
    ["/w/app/a.ts", null, "…/app/a.ts"],
  ])("%s in %s → %s", (full, cwd, shown) => {
    expect(shownPath(file([1], full), cwd)).toBe(shown);
  });

  it("falls back to the tracking path when the disk path is unknown", () => {
    expect(shownPath(file([1], null, "src/b.ts"), "/w/app")).toBe("src/b.ts");
  });
});
