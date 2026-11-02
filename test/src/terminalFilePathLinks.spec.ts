import { describe, it, expect } from "vitest";
import { findFilePathLinks } from "../../src/composables/terminalFilePathLinks";

// Helper: assert the detected texts, order preserved.
const texts = (line: string) => findFilePathLinks(line).map((l) => l.text);

describe("findFilePathLinks", () => {
  it("detects the issue's example path inside full-width parens", () => {
    const line = "📎 ↑ hero.gif を添付（~/ss/mulmoterminal-marketing/assets/media/hero.gif）";
    const links = findFilePathLinks(line);
    expect(links.map((l) => l.text)).toEqual(["~/ss/mulmoterminal-marketing/assets/media/hero.gif"]);
    const [link] = links;
    expect(line.slice(link.start, link.end)).toBe(link.text); // ranges point at the text
  });

  it("detects absolute, home, and explicit-relative paths", () => {
    expect(texts("see /Users/me/pics/a.png here")).toEqual(["/Users/me/pics/a.png"]);
    expect(texts("~/notes/todo.md")).toEqual(["~/notes/todo.md"]);
    expect(texts("./out/build.log and ../sib/x.txt")).toEqual(["./out/build.log", "../sib/x.txt"]);
  });

  it("detects a relative path with a subdirectory", () => {
    expect(texts("assets/media/hero.gif")).toEqual(["assets/media/hero.gif"]);
  });

  it("finds multiple paths on one line", () => {
    expect(texts("a/one.png b/two.mp4")).toEqual(["a/one.png", "b/two.mp4"]);
  });

  it("terminates a path at a full-width paren or Japanese period", () => {
    expect(texts("（dir/f.gif）")).toEqual(["dir/f.gif"]);
    expect(texts("生成しました dir/f.png。")).toEqual(["dir/f.png"]);
  });

  it("trims a clinging sentence period", () => {
    const [link] = findFilePathLinks("open dir/report.pdf.");
    expect(link.text).toBe("dir/report.pdf");
    expect(link.end).toBe("open dir/report.pdf".length); // period excluded from the range
  });

  it("requires a slash — a bare filename is not linked", () => {
    expect(texts("just hero.gif alone")).toEqual([]);
  });

  it("requires an extension with a letter — rejects fractions and extensionless dirs", () => {
    expect(texts("ratio 1/2.5 done")).toEqual([]);
    expect(texts("cd src/components/")).toEqual([]);
  });

  it("does not linkify a URL path (WebLinksAddon owns URLs)", () => {
    expect(texts("https://example.com/img/a.png")).toEqual([]);
    expect(texts("//cdn.example.com/a.js")).toEqual([]);
  });

  it("handles multi-dot extensions", () => {
    expect(texts("dist/app.tar.gz")).toEqual(["dist/app.tar.gz"]);
    expect(texts("a/b.7z")).toEqual(["a/b.7z"]);
  });

  it("returns nothing for empty or path-free lines", () => {
    expect(texts("")).toEqual([]);
    expect(texts("no paths on this line at all")).toEqual([]);
  });
});

// The loop used to `continue` on `match.index === undefined`. That guard was dead: matchAll
// requires a global regex and the spec sets `index` on every match it yields, which is why the
// type is `number`. These pin what it was silently protecting — the FIRST match, at index 0, and
// a run of them — so removing it stays a no-op.
describe("every match carries its index (the removed undefined guard)", () => {
  it("finds a path that starts at index 0", () => {
    expect(findFilePathLinks("src/main.ts is the entry")).toEqual([{ start: 0, end: 11, text: "src/main.ts" }]);
  });

  it("finds every path on a line, in order, with ranges that slice back to the text", () => {
    const line = "see src/a.ts and lib/b.css and docs/c.md";
    const hits = findFilePathLinks(line);

    expect(hits.map((h) => h.text)).toEqual(["src/a.ts", "lib/b.css", "docs/c.md"]);
    for (const hit of hits) expect(line.slice(hit.start, hit.end)).toBe(hit.text);
  });
});

// #2573. A location after the path joins the link, so the click can open the file at that line;
// the link's text stays the path alone, which is what every route is handed.
describe("a location after the path", () => {
  it.each([
    ["src/a.ts:42 error", "src/a.ts:42", "src/a.ts", { line: 42, col: null }],
    ["src/a.ts:42:7: error TS2345", "src/a.ts:42:7", "src/a.ts", { line: 42, col: 7 }],
    ["src/a.ts(12,5): error TS2345", "src/a.ts(12,5)", "src/a.ts", { line: 12, col: 5 }],
    ["at ./lib/b.js:3", "./lib/b.js:3", "./lib/b.js", { line: 3, col: null }],
  ])("links %j with its location", (line, linked, path, location) => {
    const [hit] = findFilePathLinks(line);
    expect(hit?.text).toBe(path);
    expect(hit?.location).toEqual(location);
    expect(hit ? line.slice(hit.start, hit.end) : null).toBe(linked);
  });

  it("carries no location when none follows", () => {
    expect(findFilePathLinks("src/a.ts: cannot find")[0]).toEqual({ start: 0, end: 8, text: "src/a.ts" });
    expect(findFilePathLinks("see src/a.ts.")[0]).toEqual({ start: 4, end: 12, text: "src/a.ts" });
  });

  it("reads each path's own location on a line with several", () => {
    const hits = findFilePathLinks("src/a.ts:1 and lib/b.ts(2,3)");
    expect(hits.map((h) => [h.text, h.location])).toEqual([
      ["src/a.ts", { line: 1, col: null }],
      ["lib/b.ts", { line: 2, col: 3 }],
    ]);
  });
});

// #3236. A Windows cell prints `\`-separated paths, often with a drive. Opt-in, because on macOS and
// Linux `\` is an ordinary file-name character.
describe("Windows paths", () => {
  const windows = (line: string) => findFilePathLinks(line, { windowsPaths: true });
  const windowsTexts = (line: string) => windows(line).map((l) => l.text);

  it.each([
    ["see .claude\\evidence\\test\\test.md now", ".claude/evidence/test/test.md", ".claude\\evidence\\test\\test.md"],
    ["edit C:\\work\\app\\src\\a.ts here", "C:/work/app/src/a.ts", "C:\\work\\app\\src\\a.ts"],
    ["open D:/w/b.ts", "D:/w/b.ts", "D:/w/b.ts"],
    ["mixed C:\\w/x\\y.md.", "C:/w/x/y.md", "C:\\w/x\\y.md"],
  ])("links %j as the printed span, handing over the `/` form", (line, path, printed) => {
    const [hit] = windows(line);
    expect(hit?.text).toBe(path);
    expect(hit ? line.slice(hit.start, hit.end) : null).toBe(printed);
  });

  it("keeps the location after a drive path", () => {
    const line = "C:\\w\\a.ts:12:3: error";
    expect(windows(line)).toEqual([{ start: 0, end: 14, text: "C:/w/a.ts", location: { line: 12, col: 3 } }]);
  });

  it("takes a drive only when it is one letter standing alone", () => {
    expect(windowsTexts("ab:/x/y.ts")).toEqual([]);
    expect(windowsTexts("a.ts:12")).toEqual([]);
    expect(windowsTexts("x1C:\\w\\a.ts")).toEqual([]);
  });

  it("still leaves URLs, UNC shares and bare names alone", () => {
    expect(windowsTexts("https://example.com/img/a.png")).toEqual([]);
    expect(windowsTexts("file:///C:/x/a.md")).toEqual([]);
    expect(windowsTexts("\\\\server\\share\\a.md")).toEqual([]);
    expect(windowsTexts("just a.md")).toEqual([]);
    expect(windowsTexts("C:\\work\\src\\")).toEqual([]);
  });

  it("is off by default: a backslash is part of the name", () => {
    expect(texts(".claude\\evidence\\test.md")).toEqual([]);
    expect(texts("C:\\work\\a.ts")).toEqual([]);
    expect(texts("odd\\name/a.md")).toEqual(["odd\\name/a.md"]);
  });
});

// #3246. Whitespace ends a token, so a path holding a space linked only its tail, which then opened
// as a cwd-relative file. Enclosed, it is linked whole — and only when it reads as ONE path.
describe("a path holding a space", () => {
  const spans = (line: string, windowsPaths = false) => findFilePathLinks(line, { windowsPaths }).map((l) => [l.text, line.slice(l.start, l.end)]);

  it.each([
    ["Read(/Users/me/My Docs/a.md)", "/Users/me/My Docs/a.md"],
    ['"/Users/me/My Docs/a.md"', "/Users/me/My Docs/a.md"],
    ["'./My Docs/a.md'", "./My Docs/a.md"],
    ["`~/My Docs/a.md`", "~/My Docs/a.md"],
    ["「/Users/me/資料 2024/a.md」", "/Users/me/資料 2024/a.md"],
    ["（../My Docs/a.md）", "../My Docs/a.md"],
  ])("links %j whole", (line, path) => {
    expect(spans(line)).toEqual([[path, path]]);
  });

  it("keeps a location inside the enclosure on the link", () => {
    const line = "`~/My Docs/a.ts:12:3`";
    expect(findFilePathLinks(line)).toEqual([{ start: 1, end: 20, text: "~/My Docs/a.ts", location: { line: 12, col: 3 } }]);
  });

  it.each([
    ["Read(/Users/me/My Docs/a.ts):12:3", { line: 12, col: 3 }],
    ["Read(/Users/me/My Docs/a.ts)(12,5)", { line: 12, col: 5 }],
  ])("keeps a location printed after the enclosure: %j", (line, location) => {
    const [hit] = findFilePathLinks(line);
    expect(hit).toEqual({ start: 5, end: line.length, text: "/Users/me/My Docs/a.ts", location });
  });

  it("links a Windows path with spaces whole, handing over the `/` form", () => {
    expect(spans('"C:\\Program Files (x86)\\app\\a.ts"', true)).toEqual([["C:/Program Files (x86)/app/a.ts", "C:\\Program Files (x86)\\app\\a.ts"]]);
  });

  it("links the enclosed path and the plain token beside it", () => {
    expect(spans('Write(/tmp/a b/c.md) and "src/c.ts"')).toEqual([
      ["/tmp/a b/c.md", "/tmp/a b/c.md"],
      ["src/c.ts", "src/c.ts"],
    ]);
  });

  it.each([
    ["words around a path", "(see src/a.ts for details)", [["src/a.ts", "src/a.ts"]]],
    [
      "two paths",
      "(./a.md and ./b.md)",
      [
        ["./a.md", "./a.md"],
        ["./b.md", "./b.md"],
      ],
    ],
    ["an unanchored start", '"My Docs/a.md"', [["Docs/a.md", "Docs/a.md"]]],
    ["a URL", '"https://x.com/a b.md"', []],
    ["a command in backticks", "`/usr/bin/grep foo.md`", []],
    ["a command line with a flag", "`/bin/bash -lc cat /tmp/My Docs/a.md`", [["Docs/a.md", "Docs/a.md"]]],
    ["a command string in JSON", '{"cmd": "/usr/bin/foo bar.md"}', []],
    ["a space in the file name itself", '"/x/My File.md"', []],
    ["across a nested bracket", "(/x/a b(/y/c d/e.md)", [["/y/c d/e.md", "/y/c d/e.md"]]],
    ["apostrophes, not quotes", "don't open /a/My Docs/b.md it's", [["Docs/b.md", "Docs/b.md"]]],
  ])("does not join %s", (_case, line, expected) => {
    expect(spans(line)).toEqual(expected);
  });

  it("leaves an unenclosed path with a space as before: only the tail", () => {
    expect(spans("/Users/me/My Docs/a.md")).toEqual([["Docs/a.md", "Docs/a.md"]]);
  });
});
