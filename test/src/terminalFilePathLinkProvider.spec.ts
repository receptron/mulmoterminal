import { describe, it, expect } from "vitest";
import { SOURCE_CODE_EXTENSIONS } from "../../common/sourceExtensions";
import {
  computeFilePathLinks,
  rawFileUrl,
  fileViewerRoute,
  fileLinkTarget,
  fileExtension,
  type TerminalCell,
} from "../../src/composables/terminalFilePathLinkProvider";

// Build a row of terminal cells from a string. Chars in WIDE occupy two columns (a
// width-2 cell + a width-0 continuation cell), as xterm stores CJK / emoji glyphs.
const WIDE = new Set(["あ", "を", "添", "付", "（", "）", "📎"]);
function toCells(s: string): TerminalCell[] {
  const cells: TerminalCell[] = [];
  for (const ch of s) {
    const width = WIDE.has(ch) ? 2 : 1;
    cells.push({ chars: ch, width });
    if (width === 2) cells.push({ chars: "", width: 0 });
  }
  return cells;
}

describe("computeFilePathLinks", () => {
  it("maps an ASCII path to 1-based inclusive columns", () => {
    const links = computeFilePathLinks(toCells("dir/x.png"));
    expect(links).toEqual([{ text: "dir/x.png", startX: 1, endX: 9 }]);
  });

  it("shifts columns past a preceding wide (CJK) glyph", () => {
    // "あ" occupies columns 1-2, so "dir/x.png" starts at column 4.
    const links = computeFilePathLinks(toCells("あ dir/x.png"));
    expect(links).toEqual([{ text: "dir/x.png", startX: 4, endX: 12 }]);
  });

  it("maps the issue's example path after wide glyphs and a full-width paren", () => {
    const [link] = computeFilePathLinks(toCells("📎 添付（dir/a.gif）"));
    expect(link.text).toBe("dir/a.gif");
    // 📎(1-2) space(3) 添(4-5) 付(6-7) （(8-9) d(10)…  → starts at column 10.
    expect(link.startX).toBe(10);
    expect(link.endX).toBe(18); // "dir/a.gif" is 9 cells: columns 10-18
  });

  it("returns nothing for a path-free row", () => {
    expect(computeFilePathLinks(toCells("no path here"))).toEqual([]);
  });
});

describe("rawFileUrl", () => {
  it("builds a cwd-scoped raw-file URL with both params encoded", () => {
    expect(rawFileUrl("assets/a b.gif", "/Users/me/proj")).toBe("/api/files/raw?cwd=%2FUsers%2Fme%2Fproj&path=assets%2Fa%20b.gif");
  });

  // A doc is for reading: the raw route serves .md as text/plain, so clicking one used to
  // open the source (#808). Same query shape, so only the route changes.
  it("sends markdown to the rendering route, keeping the same params", () => {
    expect(rawFileUrl("docs/terminal notes.md", "/Users/me/proj")).toBe("/api/files/browse/md?cwd=%2FUsers%2Fme%2Fproj&path=docs%2Fterminal%20notes.md");
  });
});

describe("fileViewerRoute", () => {
  it.each([".md", ".markdown"])("renders %s", (ext) => {
    expect(fileViewerRoute(`docs/notes${ext}`)).toBe("/api/files/browse/md");
  });

  it("matches the extension case-insensitively — README.MD is still markdown", () => {
    expect(fileViewerRoute("README.MD")).toBe("/api/files/browse/md");
    expect(fileViewerRoute("Notes.Markdown")).toBe("/api/files/browse/md");
  });

  it("indents JSON instead of serving it as one line", () => {
    expect(fileViewerRoute("package.json")).toBe("/api/files/browse/json");
  });

  // One route, because the delimiter comes from the file's own extension.
  it.each([".csv", ".tsv"])("renders %s as a table", (ext) => {
    expect(fileViewerRoute(`data/rows${ext}`)).toBe("/api/files/browse/table");
  });

  // Everything the raw route already serves well — images, PDFs, source files as text — must
  // keep going there. Only a file we can present BETTER gets a different route.
  it.each(["a.png", "a.pdf", "a.ts", "a.txt", "a.svg", "a.html", "a.yaml"])("leaves %s on the raw route", (file) => {
    expect(fileViewerRoute(file)).toBe("/api/files/raw");
  });

  it("does not treat a mid-name .md or a dotfile as an extension", () => {
    expect(fileViewerRoute("notes.md.bak")).toBe("/api/files/raw");
    expect(fileViewerRoute("archive.md.gz")).toBe("/api/files/raw");
    expect(fileViewerRoute(".mdrc")).toBe("/api/files/raw");
  });

  it("leaves an extensionless file alone", () => {
    expect(fileViewerRoute("Makefile")).toBe("/api/files/raw");
    expect(fileViewerRoute("docs/README")).toBe("/api/files/raw");
  });
});

describe("fileLinkTarget", () => {
  const CWD = "/Users/me/proj";

  // A browser tab can only show source as bytes; the app's Files view highlights it, sits
  // next to the tree, and can edit it (#808).
  it.each(["src/a.ts", "src/a.vue", "main.py", "go/main.go", "deploy.sh", "config.yaml", "styles.css"])("opens %s in the app", (file) => {
    expect(fileLinkTarget(file, CWD)).toEqual({ kind: "files" });
  });

  it.each(["docs/a.md", "data/a.csv", "package.json"])("opens %s at its rendered URL instead", (file) => {
    expect(fileLinkTarget(file, CWD)).toEqual({ kind: "url", url: rawFileUrl(file, CWD) });
  });

  // What the browser genuinely renders better than an editor would.
  it.each(["shot.png", "paper.pdf", "chart.svg", "page.html"])("keeps %s in a tab", (file) => {
    expect(fileLinkTarget(file, CWD)).toEqual({ kind: "url", url: rawFileUrl(file, CWD) });
  });

  // Until #2038 these went to the raw route, where the browser could do nothing with them and the
  // tab became a silent DOWNLOAD — no warning, no choice, a file in the downloads folder. They go
  // to the app's own view now: it cannot render them either, but it names the file and offers to
  // open it in the application that owns it. `Makefile` gains more than that — it is text, so the
  // pane simply shows it, which is what clicking it looked like it would do all along.
  it("sends a file the browser would only download to the app's own view", () => {
    expect(fileLinkTarget("Makefile", CWD)).toEqual({ kind: "files" });
    expect(fileLinkTarget("archive.bin", CWD)).toEqual({ kind: "files" });
    expect(fileLinkTarget("book.xlsx", CWD)).toEqual({ kind: "files" });
  });

  // What a tab genuinely displays still goes to a tab — the pane cannot render these, and the
  // issue asks for them to stay as they are.
  it("leaves what the browser displays at a URL", () => {
    for (const file of ["a.png", "a.pdf", "a.mp4", "a.svg"]) {
      expect(fileLinkTarget(file, CWD).kind).toBe("url");
    }
  });

  it("matches the extension case-insensitively", () => {
    expect(fileLinkTarget("SRC/A.TS", CWD)).toEqual({ kind: "files" });
  });
});

describe("fileExtension", () => {
  it("reads the last extension, lower-cased", () => {
    expect(fileExtension("a/b/C.TS")).toBe(".ts");
    expect(fileExtension("notes.md.bak")).toBe(".bak");
  });

  it("is empty when there is none, and treats a dotfile as having none", () => {
    expect(fileExtension("Makefile")).toBe("");
    expect(fileExtension(".mdrc")).toBe(".mdrc"); // a leading dot IS the name here — the tables simply don't list it
  });
});

// The shared source list is only PART of what opens in the Files view (#826), and the
// server serves a wider set as text than this module claims. Pinning both directions here
// keeps a later "tidy-up" from folding one side's extras into the shared list.
describe("the shared source list vs this module's own extras", () => {
  const CWD_ = "/w";

  it.each([...SOURCE_CODE_EXTENSIONS])("opens the shared source extension %s in the Files view", (ext) => {
    expect(fileLinkTarget(`/w/file${ext}`, CWD_)).toEqual({ kind: "files" });
  });

  // .txt is this module's own extra — the server types it through its mime table instead,
  // so it is deliberately absent from the shared list.
  it("opens .txt in the Files view although it is not in the shared list", () => {
    expect(fileLinkTarget("/w/notes.txt", CWD_)).toEqual({ kind: "files" });
    expect(SOURCE_CODE_EXTENSIONS).not.toContain(".txt");
  });

  // The server serves these as text/plain, but here they must NOT open in the Files view:
  // markdown has its own rendered route, and .html goes to a URL so the raw route can
  // serve it under the sandbox CSP.
  it.each([".md", ".markdown", ".rst", ".adoc", ".mdx", ".pl", ".r", ".dart", ".ex", ".exs", ".env", ".properties", ".html", ".htm"])(
    "sends %s to a URL rather than the Files view",
    (ext) => {
      expect(fileLinkTarget(`/w/file${ext}`, CWD_).kind).toBe("url");
      expect(SOURCE_CODE_EXTENSIONS).not.toContain(ext);
    },
  );
});
