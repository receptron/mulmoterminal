// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWikiHtml, stripFrontmatter } from "../../src/wikiMarkdown";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("stripFrontmatter", () => {
  it("drops a leading YAML frontmatter block (and BOM)", () => {
    expect(stripFrontmatter("---\ntitle: X\n---\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("﻿---\ntitle: X\n---\nhi")).toBe("hi");
  });
  it("leaves a body without frontmatter untouched", () => {
    expect(stripFrontmatter("# Body\n")).toBe("# Body\n");
  });
});

describe("renderWikiHtml", () => {
  it("renders a prose [[link]] as a focusable wiki-link", () => {
    const doc = parse(renderWikiHtml("See [[beta]] for more."));
    const link = doc.querySelector(".wiki-link");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("data-page")).toBe("beta");
    expect(link?.getAttribute("role")).toBe("link");
    expect(link?.getAttribute("tabindex")).toBe("0");
  });

  it("does NOT turn [[links]] inside code into live links", () => {
    // Both an inline code span and a fenced block: the link pass runs before marked,
    // so the bracket text ends up inert (escaped) inside <code>, never a clickable span.
    const doc = parse(renderWikiHtml("inline `[[x]]` and\n\n```\n[[y]]\n```\n"));
    expect(doc.querySelector(".wiki-link")).toBeNull();
    expect(doc.querySelectorAll("code").length).toBeGreaterThan(0);
  });

  it("rewrites a page-relative image ref to the raw-file route", () => {
    const doc = parse(renderWikiHtml("![alt](fig.png)"));
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("/api/files/raw?path=data%2Fwiki%2Fpages%2Ffig.png");
  });

  it("sanitizes scripts out of the body", () => {
    const doc = parse(renderWikiHtml("ok <script>alert(1)</script>"));
    expect(doc.querySelector("script")).toBeNull();
  });
});
