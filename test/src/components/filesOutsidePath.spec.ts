import { describe, it, expect } from "vitest";
import { isOutsidePath, outsideFileTarget } from "../../../src/components/filesOutsidePath";

// #3238, part 5. A tab path's SHAPE says whether the file is outside the pane's root: the opener
// joins an outside path absolute (`rebaseOutsideCwd` + `joinedPath`), and everything under the root
// stays relative. A wrong `true` reads a project file against the wrong base; a wrong `false` reads
// an outside file as if it were under the root, which the server refuses.
describe("isOutsidePath", () => {
  it.each(["/Users/me/other/a.md", "/a.md", "~/notes/a.md", "C:/work/other/a.ts", "d:/a.md"])("is true for %s", (path) => {
    expect(isOutsidePath(path)).toBe(true);
  });

  it.each(["docs/a.md", "a.md", "./a.md", "../a.md", "~x/a.md", "C:a.md", "src/C:/a.md"])("is false for %s", (path) => {
    expect(isOutsidePath(path)).toBe(false);
  });
});

describe("outsideFileTarget", () => {
  it("is the file's own directory and its name", () => {
    expect(outsideFileTarget("/Users/me/other/a.md")).toEqual({ cwd: "/Users/me/other", pathRel: "a.md" });
  });

  // The root directory and a drive root are the two cases where cutting at the last `/` leaves no
  // directory, or a bare drive letter the server would not take as a directory.
  it("names the root and a drive root as directories", () => {
    expect(outsideFileTarget("/a.md")).toEqual({ cwd: "/", pathRel: "a.md" });
    expect(outsideFileTarget("C:/a.md")).toEqual({ cwd: "C:/", pathRel: "a.md" });
    expect(outsideFileTarget("C:/work/a.md")).toEqual({ cwd: "C:/work", pathRel: "a.md" });
  });

  it("leaves the home prefix for the server to expand", () => {
    expect(outsideFileTarget("~/a.md")).toEqual({ cwd: "~", pathRel: "a.md" });
    expect(outsideFileTarget("~/notes/a.md")).toEqual({ cwd: "~/notes", pathRel: "a.md" });
  });
});
