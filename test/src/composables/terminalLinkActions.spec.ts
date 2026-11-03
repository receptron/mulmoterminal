// What the right-click menu on a printed path does (#3238), decided from the link and the deps.
import { describe, it, expect, vi } from "vitest";
import { absolutePathOf, openLinkInFiles, openLinkInPane, openLinkInTab, type LinkActionDeps } from "../../../src/composables/terminalLinkActions";
import type { HoveredLink } from "../../../src/composables/terminalLinkMenu";
import { filesPageUrl } from "../../../common/filesPage";

const deps = (over: Partial<LinkActionDeps> = {}): LinkActionDeps => ({
  openUrl: vi.fn(),
  openInFiles: vi.fn(),
  openOutside: vi.fn(),
  openInPane: vi.fn(() => false),
  ...over,
});
const link = (text: string, cwd = "/proj", location: HoveredLink["location"] = undefined): HoveredLink => ({ text, cwd, location });

describe("openLinkInPane", () => {
  it("stops at the pane when it takes the link, with the line printed after it", () => {
    const d = deps({ openInPane: vi.fn(() => true) });
    openLinkInPane(link("docs/a.md", "/proj", { line: 4, col: 2 }), d);
    expect(d.openInPane).toHaveBeenCalledWith("docs/a.md", "/proj", { line: 4, col: 2 }, false);
    expect(d.openUrl).not.toHaveBeenCalled();
    expect(d.openInFiles).not.toHaveBeenCalled();
  });

  it("does what a click does when the pane declines: the route for the extension", () => {
    const d = deps();
    openLinkInPane(link("docs/a.md"), d);
    expect(d.openUrl).toHaveBeenCalledWith("/api/files/browse/md?cwd=%2Fproj&path=docs%2Fa.md");
    openLinkInPane(link("src/a.ts"), d);
    expect(d.openInFiles).toHaveBeenCalledWith("src/a.ts", "/proj", undefined);
  });
});

describe("openLinkInTab", () => {
  it("opens a rendered document through its route", () => {
    const d = deps();
    openLinkInTab(link("docs/a.md"), d);
    expect(d.openUrl).toHaveBeenCalledWith("/api/files/browse/md?cwd=%2Fproj&path=docs%2Fa.md");
  });

  // A click sends source to the in-app Files view; "a new tab" means the Files page in a tab of its own.
  it("opens a source file as the Files page in a tab, never in this one", () => {
    const d = deps();
    openLinkInTab(link("src/a.ts"), d);
    expect(d.openUrl).toHaveBeenCalledWith(filesPageUrl("/proj", "src/a.ts"));
    expect(filesPageUrl("/proj", "src/a.ts")).toContain("src/a.ts");
    expect(d.openInFiles).not.toHaveBeenCalled();
  });

  it("asks for a one-file link for a picture outside the cell", () => {
    const d = deps();
    openLinkInTab(link("/elsewhere/shot.png"), d);
    expect(d.openOutside).toHaveBeenCalledWith("/elsewhere/shot.png");
    expect(d.openUrl).not.toHaveBeenCalled();
  });

  it("reads a document outside the cell against its own directory", () => {
    const d = deps();
    openLinkInTab(link("/elsewhere/notes.md"), d);
    expect(d.openUrl).toHaveBeenCalledWith("/api/files/browse/md?cwd=%2Felsewhere&path=notes.md");
  });
});

describe("openLinkInFiles", () => {
  it("hands the Files view the path under its base, with the line", () => {
    const d = deps();
    openLinkInFiles(link("src/a.ts", "/proj", { line: 42, col: null }), d);
    expect(d.openInFiles).toHaveBeenCalledWith("src/a.ts", "/proj", { line: 42, col: null });
    openLinkInFiles(link("../other/b.ts"), d);
    expect(d.openInFiles).toHaveBeenLastCalledWith("b.ts", "/other", undefined);
  });
});

describe("absolutePathOf", () => {
  it.each([
    ["src/a.ts", "/proj", "/proj/src/a.ts"],
    ["src/a.ts", "/proj/", "/proj/src/a.ts"],
    ["/abs/a.ts", "/proj", "/abs/a.ts"],
    ["~/notes/a.md", "/proj", "~/notes/a.md"],
    ["../other/b.ts", "/proj", "/other/b.ts"],
    ["src\\a.ts", "C:\\work", "C:\\work\\src\\a.ts"],
    ["C:\\other\\a.ts", "C:\\work", "C:\\other\\a.ts"],
  ])("%s printed in %s is %s", (text, cwd, abs) => {
    expect(absolutePathOf(text, cwd)).toBe(abs);
  });
});
