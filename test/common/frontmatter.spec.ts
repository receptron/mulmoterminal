import { describe, it, expect } from "vitest";
import { stripFrontmatter } from "../../common/frontmatter";

describe("stripFrontmatter", () => {
  it("drops a leading YAML frontmatter block (and BOM)", () => {
    expect(stripFrontmatter("---\ntitle: X\n---\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("\uFEFF---\ntitle: X\n---\nhi")).toBe("hi");
  });
  it("leaves a body without frontmatter untouched", () => {
    expect(stripFrontmatter("# Body\n")).toBe("# Body\n");
  });

  // #2264: a rule in the middle of a document is not front matter.
  it("leaves a --- that is not at the very top alone", () => {
    const text = "# Title\n\n---\n\nkey: value\n\n---\n\nmore\n";
    expect(stripFrontmatter(text)).toBe(text);
  });

  it("handles CRLF line endings", () => {
    expect(stripFrontmatter("---\r\ntitle: X\r\n---\r\n# Body\r\n")).toBe("# Body\r\n");
  });

  it("leaves an unclosed block alone", () => {
    expect(stripFrontmatter("---\ntitle: X\n# Body\n")).toBe("---\ntitle: X\n# Body\n");
  });
});
