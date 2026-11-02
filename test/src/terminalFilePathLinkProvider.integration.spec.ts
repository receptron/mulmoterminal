// Integration check against the REAL xterm Terminal (not the unit mock): confirms that
// our cell reading + column mapping + link ranges agree with how xterm actually stores
// wide (CJK) glyphs and numbers its columns. This is the part the pure unit tests can't
// vouch for.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { Terminal } from "@xterm/xterm";
import { createFilePathLinkProvider } from "../../src/composables/terminalFilePathLinkProvider";
import type { ILink } from "@xterm/xterm";
import type { FileLocation } from "../../src/composables/filePathLocation";

// xterm's Terminal.open() reaches for browser APIs jsdom omits; stub the few it needs.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

async function writeLine(term: Terminal, text: string): Promise<void> {
  await new Promise<void>((resolve) => term.write(text, resolve));
}

function provideLinks(
  term: Terminal,
  cwd: string | null,
  open: (url: string) => void,
  openInFiles: (filePath: string, cwd: string) => void = () => {},
  // Nothing enlarged is the default for these cases, so the pane declines and the routing
  // below it is what gets exercised.
  openInPane: (filePath: string, cwd: string, location: FileLocation | undefined, newTab: boolean) => boolean = () => false,
  openOutside: (absPath: string) => void = () => {},
): ILink[] | undefined {
  const provider = createFilePathLinkProvider(term, () => cwd, open, openInFiles, openInPane, openOutside);
  let result: ILink[] | undefined;
  provider.provideLinks(1, (links) => {
    result = links;
  });
  return result;
}

describe("createFilePathLinkProvider against real xterm", () => {
  it("linkifies the path after CJK text and opens the cwd-scoped raw URL", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "添付（dir/a.gif）");

    const open = vi.fn();
    const links = provideLinks(term, "/Users/me/proj", open);
    if (!links) throw new Error("expected the provider to return links");
    expect(links).toHaveLength(1);

    const [link] = links;
    expect(link.text).toBe("dir/a.gif");
    // 添(1-2) 付(3-4) （(5-6) d(7)…f(15) — real xterm columns, 1-based inclusive.
    expect(link.range).toEqual({ start: { x: 7, y: 1 }, end: { x: 15, y: 1 } });

    link.activate(new MouseEvent("click"), link.text);
    expect(open).toHaveBeenCalledWith("/api/files/raw?cwd=%2FUsers%2Fme%2Fproj&path=dir%2Fa.gif");

    term.dispose();
  });

  // The other arm of activate(): a source path never opens a tab, it hands the path to the
  // app's Files view (#808).
  it("hands a clicked source path to the Files view instead of opening a tab", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "see src/main.ts for details");

    const open = vi.fn();
    const openInFiles = vi.fn();
    const links = provideLinks(term, "/Users/me/proj", open, openInFiles);
    if (!links) throw new Error("expected the provider to return links");

    const [link] = links;
    expect(link.text).toBe("src/main.ts");
    link.activate(new MouseEvent("click"), link.text);
    expect(openInFiles).toHaveBeenCalledWith("src/main.ts", "/Users/me/proj", undefined);
    expect(open).not.toHaveBeenCalled();

    term.dispose();
  });

  // The pane gets first refusal (#910). Taking the click has to stop BOTH of the routes
  // below it — a path that opened in the pane and also in a new tab would be the worst of
  // each, and the tab is what the pane exists to avoid.
  it("stops at the pane when it takes the click, opening neither a tab nor the Files view", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "see src/main.ts and docs/a.md and dir/a.gif");

    const open = vi.fn();
    const openInFiles = vi.fn();
    const openInPane = vi.fn(() => true);
    const links = provideLinks(term, "/Users/me/proj", open, openInFiles, openInPane);
    if (!links) throw new Error("expected the provider to return links");
    expect(links.map((l) => l.text)).toEqual(["src/main.ts", "docs/a.md", "dir/a.gif"]);

    links.forEach((link) => link.activate(new MouseEvent("click"), link.text));
    expect(openInPane.mock.calls).toEqual([
      ["src/main.ts", "/Users/me/proj", undefined, false],
      ["docs/a.md", "/Users/me/proj", undefined, false],
      ["dir/a.gif", "/Users/me/proj", undefined, false],
    ]);
    expect(open).not.toHaveBeenCalled();
    expect(openInFiles).not.toHaveBeenCalled();

    term.dispose();
  });

  // #3005. Cmd (macOS) or Ctrl (elsewhere) on the click asks the pane for a new tab, as the tree does;
  // a plain click and one with only Shift or Alt do not.
  it("asks the pane for a new tab only on Cmd or Ctrl", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "see src/main.ts");

    const openInPane = vi.fn<(filePath: string, cwd: string, location: FileLocation | undefined, newTab: boolean) => boolean>(() => true);
    const [link] = provideLinks(term, "/Users/me/proj", vi.fn(), vi.fn(), openInPane) ?? [];
    if (!link) throw new Error("expected a link");
    const clicks: MouseEventInit[] = [{ metaKey: true }, { ctrlKey: true }, {}, { shiftKey: true }, { altKey: true }];
    clicks.forEach((init) => link.activate(new MouseEvent("click", init), link.text));
    expect(openInPane.mock.calls.map((call) => call[3])).toEqual([true, true, false, false, false]);

    term.dispose();
  });

  // #2573. The line printed after the path reaches whichever view takes the click.
  it("hands the pane and the Files view the line printed after the path", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "src/main.ts:42:7 and lib/b.ts(12,5)");

    const openInFiles = vi.fn();
    const openInPane = vi.fn((path: string) => path === "src/main.ts");
    const links = provideLinks(term, "/Users/me/proj", vi.fn(), openInFiles, openInPane);
    if (!links) throw new Error("expected the provider to return links");
    // The text is the path alone; the underline runs on over the location.
    expect(links.map((l) => [l.text, l.range.start.x, l.range.end.x])).toEqual([
      ["src/main.ts", 1, 16],
      ["lib/b.ts", 22, 35],
    ]);

    links.forEach((link) => link.activate(new MouseEvent("click"), link.text));
    expect(openInPane).toHaveBeenCalledWith("src/main.ts", "/Users/me/proj", { line: 42, col: 7 }, false);
    expect(openInFiles).toHaveBeenCalledWith("lib/b.ts", "/Users/me/proj", { line: 12, col: 5 });

    term.dispose();
  });

  it("provides no links when the session cwd is unknown", async () => {
    const term = new Terminal({ cols: 80, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "dir/a.gif");
    expect(provideLinks(term, null, vi.fn())).toBeUndefined();
    term.dispose();
  });

  // #2260. The routes contain `path` within `cwd`, so a path outside the cell handed over with the
  // cell's cwd came back "path escapes the project root". It goes with its own directory instead.
  it.each([
    ["a document", "/tmp/report.md", "/api/files/browse/md?cwd=%2Ftmp&path=report.md"],
    ["a home-relative document", "~/Downloads/r.md", "/api/files/browse/md?cwd=~%2FDownloads&path=r.md"],
  ])("opens %s outside the cell against its own directory", async (_case, token, url) => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, `wrote ${token}`);
    const open = vi.fn();
    const [link] = provideLinks(term, "/Users/me/proj", open) ?? [];
    if (!link) throw new Error("expected a link");
    link.activate(new MouseEvent("click"), link.text);
    expect(open).toHaveBeenCalledWith(url);
    term.dispose();
  });

  it("hands source outside the cell to the Files view rooted at its directory", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "see ../other/notes.ts");
    const openInFiles = vi.fn();
    const [link] = provideLinks(term, "/Users/me/proj", vi.fn(), openInFiles) ?? [];
    if (!link) throw new Error("expected a link");
    link.activate(new MouseEvent("click"), link.text);
    expect(openInFiles).toHaveBeenCalledWith("notes.ts", "/Users/me/other", undefined);
    term.dispose();
  });

  // #3024. The raw route refuses a directory that is not served, so a file a tab SHOWS goes for a
  // one-file URL instead, with its whole path; one the Files view or a browse route handles does not.
  it.each([
    ["a video", "/tmp/out/clip.mp4", "/tmp/out/clip.mp4"],
    ["a home-relative image", "~/Pictures/a.png", "~/Pictures/a.png"],
    ["a PDF reached by climbing", "../shared/r.pdf", "/Users/me/shared/r.pdf"],
    ["an HTML page", "/tmp/site/index.html", "/tmp/site/index.html"],
    ["a file at the root", "/a.mp3", "/a.mp3"],
  ])("asks for a one-file URL for %s outside the cell", async (_case, token, absPath) => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, `wrote ${token}`);
    const open = vi.fn();
    const openOutside = vi.fn();
    const [link] =
      provideLinks(
        term,
        "/Users/me/proj",
        open,
        () => {},
        () => false,
        openOutside,
      ) ?? [];
    if (!link) throw new Error("expected a link");
    link.activate(new MouseEvent("click"), link.text);
    expect(openOutside).toHaveBeenCalledWith(absPath);
    expect(open).not.toHaveBeenCalled();
    term.dispose();
  });

  it.each([
    ["inside the cell", "out/clip.mp4"],
    ["a Markdown file outside", "/tmp/report.md"],
    ["source outside", "../other/notes.ts"],
  ])("does not ask for a one-file URL for %s", async (_case, token) => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, `wrote ${token}`);
    const openOutside = vi.fn();
    const [link] =
      provideLinks(
        term,
        "/Users/me/proj",
        vi.fn(),
        () => {},
        () => false,
        openOutside,
      ) ?? [];
    if (!link) throw new Error("expected a link");
    link.activate(new MouseEvent("click"), link.text);
    expect(openOutside).not.toHaveBeenCalled();
    term.dispose();
  });
});

// #3236. Which cell decides whether `\` separates: a Windows cwd does, anything else does not.
describe("Windows paths against real xterm", () => {
  const LINE = "edit C:\\w\\app\\src\\a.ts:12 and .claude\\e\\t.md";

  it("links them in a Windows cell over the printed columns, handing the `/` form to the pane", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, LINE);
    const openInPane = vi.fn(() => true);
    const links = provideLinks(term, "C:\\w\\app", vi.fn(), () => {}, openInPane) ?? [];
    expect(links.map((l) => [l.text, l.range.start.x, l.range.end.x])).toEqual([
      ["C:/w/app/src/a.ts", 6, 25],
      [".claude/e/t.md", 31, 44],
    ]);
    links.forEach((link) => link.activate(new MouseEvent("click"), link.text));
    expect(openInPane.mock.calls).toEqual([
      ["C:/w/app/src/a.ts", "C:\\w\\app", { line: 12, col: null }, false],
      [".claude/e/t.md", "C:\\w\\app", undefined, false],
    ]);
    term.dispose();
  });

  it("leaves them alone in a macOS or Linux cell", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, LINE);
    expect(provideLinks(term, "/Users/me/proj", vi.fn())).toBeUndefined();
    term.dispose();
  });
});

// #3246. A path holding a space, enclosed as an agent's tool line prints it, is one link over the
// columns it was printed in, and the click hands the pane the whole path.
describe("a path holding a space against real xterm", () => {
  it("links it whole and hands the whole path to the pane", async () => {
    const term = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
    term.open(document.createElement("div"));
    await writeLine(term, "Read(/Users/me/proj/My Docs/a.md)");
    const openInPane = vi.fn(() => true);
    const links = provideLinks(term, "/Users/me/proj", vi.fn(), () => {}, openInPane) ?? [];
    expect(links.map((l) => [l.text, l.range.start.x, l.range.end.x])).toEqual([["/Users/me/proj/My Docs/a.md", 6, 32]]);
    links.forEach((link) => link.activate(new MouseEvent("click"), link.text));
    expect(openInPane.mock.calls).toEqual([["/Users/me/proj/My Docs/a.md", "/Users/me/proj", undefined, false]]);
    term.dispose();
  });
});
