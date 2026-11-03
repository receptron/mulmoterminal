import { describe, it, expect } from "vitest";
import { previewLinkTarget } from "../../../src/components/previewLinkTarget";

const file = (path: string) => ({ kind: "file", path });
const OUTSIDE = { kind: "outside" };
const NONE = { kind: "none" };

// #2268. A link in the Preview is written relative to the DOCUMENT, and the pane opens paths
// relative to its ROOT; everything here is about getting from one to the other.
describe("previewLinkTarget", () => {
  it.each([
    ["docs/a.md", "./b.md", "docs/b.md"],
    ["docs/a.md", "b.md", "docs/b.md"],
    ["docs/a.md", "sub/c.md", "docs/sub/c.md"],
    ["docs/a.md", "../README.md", "README.md"],
    ["docs/deep/a.md", "../../src/index.ts", "src/index.ts"],
    ["README.md", "docs/guide.md", "docs/guide.md"],
    ["docs/a.md", "./x/../b.md", "docs/b.md"],
    ["docs/a.md", ".//b.md", "docs/b.md"],
  ])("resolves %s + %s to %s", (doc, href, path) => {
    expect(previewLinkTarget(doc, href)).toEqual(file(path));
  });

  // A leading `/` is the root, as a README's links read on the forge that hosts it.
  it("reads a leading slash as the pane's root", () => {
    expect(previewLinkTarget("docs/a.md", "/README.md")).toEqual(file("README.md"));
    expect(previewLinkTarget("docs/a.md", "/docs/b.md")).toEqual(file("docs/b.md"));
  });

  // The fragment names a heading in the OTHER file, which the pane cannot reach; the file still opens.
  it("drops a fragment and a query from a link to another file", () => {
    expect(previewLinkTarget("docs/a.md", "b.md#usage")).toEqual(file("docs/b.md"));
    expect(previewLinkTarget("docs/a.md", "b.md?plain=1")).toEqual(file("docs/b.md"));
  });

  it("decodes escapes, as the browser would before asking for the file", () => {
    expect(previewLinkTarget("docs/a.md", "my%20notes.md")).toEqual(file("docs/my notes.md"));
    expect(previewLinkTarget("docs/a.md", "%E3%83%A1%E3%83%A2.md")).toEqual(file("docs/メモ.md"));
  });

  it.each([
    ["docs/a.md", "../../x.md"],
    ["README.md", "../x.md"],
    ["docs/a.md", "/../x.md"],
    ["docs/a.md", "..%2F..%2Fx.md"],
  ])("refuses %s + %s as outside the root", (doc, href) => {
    expect(previewLinkTarget(doc, href)).toEqual(OUTSIDE);
  });

  // An escape cannot smuggle a climb past the check: decoding happens before the walk.
  it("walks a climb spelled with escapes like any other", () => {
    expect(previewLinkTarget("docs/a.md", "..%2Fb.md")).toEqual(file("b.md"));
  });

  it.each([
    ["#heading"],
    [""],
    ["https://example.com/a.md"],
    ["mailto:a@example.com"],
    ["javascript:alert(1)"],
    ["file:///etc/passwd"],
    ["//cdn.example/x.md"],
    ["./sub/"],
    ["./"],
    ["."],
    [".."],
    ["sub/.."],
    ["?q=1"],
    ["%E0%A4%A"],
  ])("opens nothing for %j", (href) => {
    expect(previewLinkTarget("docs/a.md", href)).toEqual(NONE);
  });
});

// #3238, part 5. A document outside the root is open on its own, and the one file is all the pane
// reaches from it: a sibling, a child, the root itself — every path is outside. An anchor or another
// scheme is still nothing to open, as in any document.
describe("a document outside the root", () => {
  it("has every path link pointing outside", () => {
    expect(previewLinkTarget("/elsewhere/report.md", "./notes.md")).toEqual({ kind: "outside" });
    expect(previewLinkTarget("/elsewhere/report.md", "sub/a.md")).toEqual({ kind: "outside" });
    expect(previewLinkTarget("/elsewhere/report.md", "/README.md")).toEqual({ kind: "outside" });
    expect(previewLinkTarget("~/notes/a.md", "b.md")).toEqual({ kind: "outside" });
  });

  it("still opens nothing for an anchor, another scheme or a folder", () => {
    expect(previewLinkTarget("/elsewhere/report.md", "#heading")).toEqual({ kind: "none" });
    expect(previewLinkTarget("/elsewhere/report.md", "https://example.com/")).toEqual({ kind: "none" });
    expect(previewLinkTarget("/elsewhere/report.md", "sub/")).toEqual({ kind: "none" });
  });
});
