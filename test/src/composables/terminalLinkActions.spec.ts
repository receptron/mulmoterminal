// What the right-click menu on a printed path does (#3238), decided from the link and the deps.
import { describe, it, expect, vi } from "vitest";
import { absolutePathOf, openLinkInFiles, openLinkInPane, openLinkInTab, type LinkActionDeps } from "../../../src/composables/terminalLinkActions";
import type { HoveredLink, LinkMenuRequest } from "../../../src/composables/terminalLinkMenu";

const deps = (over: Partial<LinkActionDeps> = {}): LinkActionDeps => ({
  openUrl: vi.fn(),
  openInFiles: vi.fn(),
  openOutside: vi.fn(),
  openInPane: vi.fn(() => false),
  ...over,
});
const link = (text: string, cwd = "/proj", location: HoveredLink["location"] = undefined): HoveredLink => ({ text, cwd, location });
// The pane action alone takes the menu's whole request: the cell the click came from decides where
// the pane opens on the tiled grid (#3238).
const request = (text: string, cwd = "/proj", location: HoveredLink["location"] = undefined): LinkMenuRequest => ({
  ...link(text, cwd, location),
  session: "s1",
  point: { top: 1, left: 1 },
});

describe("openLinkInPane", () => {
  it("stops at the pane when it takes the link, with the line printed after it", () => {
    const d = deps({ openInPane: vi.fn(() => true) });
    openLinkInPane(request("docs/a.md", "/proj", { line: 4, col: 2 }), d);
    expect(d.openInPane).toHaveBeenCalledWith("docs/a.md", "/proj", { line: 4, col: 2 }, false, "s1");
    expect(d.openUrl).not.toHaveBeenCalled();
    expect(d.openInFiles).not.toHaveBeenCalled();
  });

  it("does what a click does when the pane declines: the route for the extension", () => {
    const d = deps();
    openLinkInPane(request("docs/a.md"), d);
    expect(d.openUrl).toHaveBeenCalledWith("/api/files/browse/md?cwd=%2Fproj&path=docs%2Fa.md");
    openLinkInPane(request("src/a.ts"), d);
    expect(d.openInFiles).toHaveBeenCalledWith("src/a.ts", "/proj", undefined);
  });
});

describe("openLinkInTab", () => {
  // A rendered document goes to its route; a document outside the cell is read against its own
  // directory; a backslash in a name on a POSIX cwd rides encoded in the Files view's query
  // rather than as a path segment a route would refuse (CodeRabbit on #3256).
  it.each([
    ["docs/a.md", "/api/files/browse/md?cwd=%2Fproj&path=docs%2Fa.md"],
    ["/elsewhere/notes.md", "/api/files/browse/md?cwd=%2Felsewhere&path=notes.md"],
    ["src/lib\\a.ts", "/files?cwd=%2Fproj&path=src%2Flib%5Ca.ts"],
  ])("opens %s at %s", (text, url) => {
    const d = deps();
    openLinkInTab(link(text), d);
    expect(d.openUrl).toHaveBeenCalledWith(url);
    expect(d.openInFiles).not.toHaveBeenCalled();
  });

  // A click sends source to the in-app Files view; "a new tab" means that view in a tab of its own,
  // addressed by query like a click's navigation — never the HTML page route, which serves pages.
  it("opens a source file as the Files view in a tab, with the line, never in this one", () => {
    const d = deps();
    openLinkInTab(link("src/a.ts", "/proj", { line: 42, col: 7 }), d);
    expect(d.openUrl).toHaveBeenCalledWith("/files?cwd=%2Fproj&path=src%2Fa.ts&line=42&col=7");
    expect(d.openInFiles).not.toHaveBeenCalled();
  });

  it("asks for a one-file link for a picture outside the cell", () => {
    const d = deps();
    openLinkInTab(link("/elsewhere/shot.png"), d);
    expect(d.openOutside).toHaveBeenCalledWith("/elsewhere/shot.png");
    expect(d.openUrl).not.toHaveBeenCalled();
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
    // Resolved, not just joined: a `.` or `..` inside the cell, and a `..` out of it in a Windows
    // cell, come out as the filesystem would spell them (Codex on #3256).
    ["src/../a.ts", "/proj", "/proj/a.ts"],
    ["./a.ts", "/proj", "/proj/a.ts"],
    ["../../x.ts", "/proj", "/x.ts"],
    ["a.ts", "/", "/a.ts"],
    ["..\\other\\a.ts", "C:\\work", "C:\\other\\a.ts"],
    ["src/a.ts", "C:\\work", "C:\\work\\src\\a.ts"],
    ["src/lib\\a.ts", "/proj", "/proj/src/lib\\a.ts"],
  ])("%s printed in %s is %s", (text, cwd, abs) => {
    expect(absolutePathOf(text, cwd)).toBe(abs);
  });
});
