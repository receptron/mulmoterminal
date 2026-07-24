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
