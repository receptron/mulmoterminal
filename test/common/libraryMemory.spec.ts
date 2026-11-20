// Claude Code's memory as the Library reads it (#3331): the frontmatter, and the folder a directory's
// memory is kept in.
import { describe, it, expect } from "vitest";
import { isLibraryMemoryProject, parseMemoryFrontmatter, projectSlug } from "../../common/libraryMemory";

describe("parseMemoryFrontmatter", () => {
  it("reads the flat keys and the metadata block apart from the body, keeping keys it does not know", () => {
    const text = [
      "---",
      "name: reply-in-japanese",
      'description: "every reply in Japanese: \\"always\\""',
      "metadata:",
      "  type: feedback",
      "  originSessionId: 1d58",
      "extra: kept",
      "---",
      "",
      "Body line [[other]].",
    ].join("\n");
    expect(parseMemoryFrontmatter(text)).toEqual({
      fields: { name: "reply-in-japanese", description: 'every reply in Japanese: "always"', extra: "kept" },
      metadata: { type: "feedback", originSessionId: "1d58" },
      body: "\nBody line [[other]].",
    });
  });

  it("reads a file with no frontmatter, or an unclosed one, as all body", () => {
    expect(parseMemoryFrontmatter("just text")).toEqual({ fields: {}, metadata: {}, body: "just text" });
    expect(parseMemoryFrontmatter("---\nname: x\nno close")).toEqual({ fields: {}, metadata: {}, body: "---\nname: x\nno close" });
  });

  it("keeps an indented key under another block out of the metadata", () => {
    const parsed = parseMemoryFrontmatter("---\nother:\n  nested: x\nmetadata:\n  type: user\n---\n");
    expect(parsed.metadata).toEqual({ type: "user" });
    expect(parsed.fields).toEqual({ other: "" });
  });

  it("ends the frontmatter only at a line of exactly ---, which may be the last line", () => {
    expect(parseMemoryFrontmatter("---\nname: a\n---draft: x\n---\nbody")).toEqual({ fields: { name: "a" }, metadata: {}, body: "body" });
    expect(parseMemoryFrontmatter("---\nname: last\n---")).toEqual({ fields: { name: "last" }, metadata: {}, body: "" });
  });

  it("reads frontmatter behind a byte-order mark", () => {
    expect(parseMemoryFrontmatter("\uFEFF---\nname: marked\n---\nbody")).toEqual({ fields: { name: "marked" }, metadata: {}, body: "body" });
  });

  it("reads Windows line endings and single quotes", () => {
    expect(parseMemoryFrontmatter("---\r\nname: 'it''s'\r\n---\r\nbody").fields).toEqual({ name: "it's" });
  });
});

describe("projectSlug", () => {
  it.each([
    ["/Users/isamu/ss/llm/mulmoterminal3", "-Users-isamu-ss-llm-mulmoterminal3"],
    ["/Users/me/my.app_v2", "-Users-me-my-app_v2"],
    ["/Users/me/日本語", "-Users-me----"],
    ["C:\\work\\app", "C--work-app"],
    ["", "unknown"],
  ])("%s → %s", (cwd, slug) => {
    expect(projectSlug(cwd)).toBe(slug);
  });
});

describe("isLibraryMemoryProject", () => {
  it("needs the shape the server sends", () => {
    const file = { file: "a.md", name: null, description: null, type: null, updatedAt: 1 };
    expect(isLibraryMemoryProject({ slug: "s", cwd: null, index: null, files: [file] })).toBe(true);
    expect(isLibraryMemoryProject({ slug: "s", cwd: null, index: { lines: 1 }, files: [] })).toBe(false);
    expect(isLibraryMemoryProject({ slug: "s", cwd: null, index: null, files: [{ ...file, updatedAt: "1" }] })).toBe(false);
  });
});
