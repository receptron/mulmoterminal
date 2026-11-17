// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs, { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { swappableProject as project } from "../../support/swappableProject.js";
import { realContainedWithin } from "../../../server/files/pathContainment";
import { makeFolderVerified, makeFoldersVerified } from "../../../server/files/verifiedMkdir";

// #3306 for folders: `docs` is swapped for a link out at the first mkdir, after the check has answered.
const swapOutOnFirstMkdir = (swapOut: () => void) => {
  const mkdir = fs.mkdirSync;
  const swapped = { done: false };
  vi.spyOn(fs, "mkdirSync").mockImplementation((...args: Parameters<typeof fs.mkdirSync>) => {
    if (!swapped.done) {
      swapped.done = true;
      swapOut();
    }
    return mkdir(...args);
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeFolderVerified", () => {
  it("makes the folder when nothing moved", () => {
    const { root, recheck, cleanup } = project();
    expect(makeFolderVerified(path.join(root, "docs", "new"), recheck("docs/new"))).toBe("written");
    expect(lstatSync(path.join(root, "docs", "new")).isDirectory()).toBe(true);
    cleanup();
  });

  it("reports a folder that landed outside, which is left there empty", () => {
    const { root, outside, recheck, swapOut, cleanup } = project();
    swapOutOnFirstMkdir(swapOut);
    expect(makeFolderVerified(path.join(root, "docs", "new"), recheck("docs/new"))).toBe("escaped");
    expect(readdirSync(path.join(outside, "new"))).toEqual([]);
    cleanup();
  });

  // The known limit, pinned so a stronger check shows up as a change here.
  it("is passed by a swap undone before the check is asked again (documented limit)", () => {
    const { root, outside, recheck, swapOut, swapBack, cleanup } = project();
    swapOutOnFirstMkdir(swapOut);
    const recheckAfterSwapBack = () => {
      swapBack();
      mkdirSync(path.join(root, "docs", "new")); // what the check now names must exist to be named
      return recheck("docs/new")();
    };
    expect(makeFolderVerified(path.join(root, "docs", "new"), recheckAfterSwapBack)).toBe("written");
    expect(existsSync(path.join(outside, "new"))).toBe(true);
    cleanup();
  });

  it("throws EEXIST over an existing name, as mkdir does", () => {
    const { root, recheck, cleanup } = project();
    expect(() => makeFolderVerified(path.join(root, "docs"), recheck("docs"))).toThrow(expect.objectContaining({ code: "EEXIST" }));
    cleanup();
  });
});

describe("makeFoldersVerified", () => {
  const containedIn = (root: string) => (abs: string) => realContainedWithin(root, abs);

  it("makes every missing level when nothing moved", () => {
    const { root, cleanup } = project();
    expect(makeFoldersVerified(path.join(root, "docs", "a", "b", "c"), containedIn(root))).toBe("written");
    expect(lstatSync(path.join(root, "docs", "a", "b", "c")).isDirectory()).toBe(true);
    expect(makeFoldersVerified(path.join(root, "docs", "a", "b", "c"), containedIn(root))).toBe("written");
    cleanup();
  });

  it("stops at the first level that landed outside: one empty folder there, nothing deeper", () => {
    const { root, outside, swapOut, cleanup } = project();
    swapOutOnFirstMkdir(swapOut);
    expect(makeFoldersVerified(path.join(root, "docs", "a", "b"), containedIn(root))).toBe("escaped");
    expect(readdirSync(path.join(outside, "a"))).toEqual([]);
    cleanup();
  });

  it("makes nothing under an existing folder that already leads out", () => {
    const { root, outside, swapOut, cleanup } = project();
    swapOut();
    expect(makeFoldersVerified(path.join(root, "docs", "a"), containedIn(root))).toBe("escaped");
    expect(existsSync(path.join(outside, "a"))).toBe(false);
    cleanup();
  });
});
