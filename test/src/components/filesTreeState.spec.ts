import { describe, it, expect } from "vitest";
import { ancestorDirs, expandedPaths, restoreOrder, type TreeNode } from "../../../src/components/filesTreeState";

const dir = (path: string, expanded: boolean, children: TreeNode[] = []): TreeNode => ({ path, dir: true, expanded, children });
const file = (path: string): TreeNode => ({ path, dir: false, expanded: false, children: [] });

describe("expandedPaths", () => {
  it("collects open directories, parents before their children", () => {
    const tree = [dir("src", true, [dir("src/deep", true, [file("src/deep/a.ts")]), file("src/b.ts")]), dir("docs", false, []), file("README.md")];
    expect(expandedPaths(tree)).toEqual(["src", "src/deep"]);
  });

  it("ignores files and closed directories, and descends only into open ones", () => {
    const tree = [dir("closed", false, [dir("closed/inner", true, [])]), file("a.md")];
    expect(expandedPaths(tree)).toEqual([]);
  });

  it("has nothing to say about an empty tree", () => {
    expect(expandedPaths([])).toEqual([]);
  });
});

describe("restoreOrder", () => {
  // Opening a directory fetches its children, so a child cannot be opened before its parent
  // has been — whatever order the remembered list happens to be in.
  it("puts shallower paths first", () => {
    expect(restoreOrder(["a/b/c", "a", "a/b"])).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("orders same-depth paths predictably, and drops duplicates", () => {
    expect(restoreOrder(["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("is empty for nothing remembered", () => {
    expect(restoreOrder([])).toEqual([]);
  });
});

describe("ancestorDirs", () => {
  it("lists the directories to open, outermost first", () => {
    expect(ancestorDirs("a/b/c.ts")).toEqual(["a", "a/b"]);
  });

  it("has nothing to open for a file at the root", () => {
    expect(ancestorDirs("README.md")).toEqual([]);
  });

  it("ignores empty segments from a doubled or trailing separator", () => {
    expect(ancestorDirs("a//b/c.ts")).toEqual(["a", "a/b"]);
  });

  it("has nothing to say about an empty path", () => {
    expect(ancestorDirs("")).toEqual([]);
  });
});
