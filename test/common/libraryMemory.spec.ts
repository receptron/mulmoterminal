// Claude Code's memory as the Library reads it (#3331): the frontmatter, and the folder a directory's
// memory is kept in.
import { describe, it, expect } from "vitest";
import {
  frontmatterStillOpen,
  isLibraryMemoryHealth,
  isLibraryMemoryProject,
  linkNamesMemory,
  memoryBodyStart,
  memoryLinkNames,
  memoryType,
  parseMemoryFrontmatter,
} from "../../common/libraryMemory";
import { seededRandom } from "../helpers/seededRandom";

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

describe("frontmatterStillOpen", () => {
  it.each([
    ["---\nname: a\n", true],
    ["\uFEFF---\nname: a\n", true],
    ["---\r\nname: a\r\n", true],
    ["---\nname: a\n---\nbody", false],
    ["---\nname: a\n---", false],
    ["---\nname: a\n---draft", true],
    ["no frontmatter", false],
    ["", false],
  ])("%j → %s", (text, open) => {
    expect(frontmatterStillOpen(text)).toBe(open);
  });
});

describe("memoryBodyStart", () => {
  it("is where the parser's body starts, in the text as written", () => {
    expect(memoryBodyStart("---\nname: a\n---\nbody")).toBe(16);
    expect(memoryBodyStart("---\r\nname: a\r\n---\r\nbody")).toBe(19);
    expect(memoryBodyStart("\uFEFF---\nx: y\n---\n")).toBe(14);
    expect(memoryBodyStart("---\n---\nbody")).toBe(8);
    expect(memoryBodyStart("---\nname: a\n---")).toBe(15);
    expect(["no frontmatter", "---\nnever closed\n", "---draft\n---\n", "\n---\nx\n---\n", "---\rx\r---\r"].map(memoryBodyStart)).toEqual([0, 0, 0, 0, 0]);
  });

  it("agrees with parseMemoryFrontmatter over generated texts (seed 3334)", () => {
    const random = seededRandom(3334);
    const PIECES = ["---", "--- ", "---x", "name: a", "", "body [[a]]", "\uFEFF", "`c`"];
    const ENDS = ["\n", "\r\n", "\r"];
    Array.from({ length: 3000 }).forEach(() => {
      const text = Array.from({ length: random.below(7) }, () => random.pick(PIECES) + random.pick(ENDS)).join("") + random.pick(["", "tail"]);
      const start = memoryBodyStart(text);
      const body = start === 0 ? text : text.slice(start).replace(/\r\n/g, "\n");
      expect(body, JSON.stringify(text)).toBe(parseMemoryFrontmatter(text).body);
    });
  });
});

describe("linkNamesMemory / memoryLinkNames", () => {
  it("names a memory by its file without .md or its frontmatter name, either side's spaces aside", () => {
    const memory = { file: "a.md", name: " alpha " };
    expect(["a", "alpha", " alpha", "a ", "a.md", "alph", ""].map((link) => linkNamesMemory(link, memory))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(linkNamesMemory("x", { file: "a.md", name: null })).toBe(false);
    expect(linkNamesMemory(" ", { file: "a.md", name: "   " })).toBe(false);
    expect(memoryLinkNames(memory)).toEqual(["a", "alpha"]);
    expect(memoryLinkNames({ file: "a.md", name: "a" })).toEqual(["a"]);
    expect(memoryLinkNames({ file: "a.md", name: "  " })).toEqual(["a"]);
  });

  it("agrees with itself: a link names a memory exactly when its trimmed text is one of the memory's names", () => {
    const LINKS = ["a", " a", "alpha", "alpha ", "b", "", " ", "a.md"];
    const NAMES = [null, "", " ", "alpha", " alpha ", "a", "b c"];
    LINKS.forEach((link) =>
      NAMES.forEach((name) => {
        const memory = { file: "a.md", name };
        expect(linkNamesMemory(link, memory)).toBe(memoryLinkNames(memory).includes(link.trim()));
      }),
    );
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

describe("memoryType", () => {
  it.each([
    [{ metadata: { type: "feedback" }, fields: {} }, "feedback"],
    [{ metadata: {}, fields: { type: "user" } }, "user"],
    [{ metadata: { type: "  " }, fields: { type: "user" } }, "user"],
    [{ metadata: { type: "project" }, fields: { type: "user" } }, "project"],
    [{ metadata: {}, fields: {} }, null],
  ])("%j → %s", (frontmatter, type) => {
    expect(memoryType(frontmatter)).toBe(type);
  });
});

describe("isLibraryMemoryHealth", () => {
  const withIssue = (issue: unknown) => ({ slug: "-w", issues: [], files: { "a.md": [issue] } });
  it("accepts a work-copies issue naming at least one copy", () => {
    expect(isLibraryMemoryHealth(withIssue({ kind: "in-work-copies", copies: [{ slug: "-w2", same: true }] }))).toBe(true);
  });
  it.each([
    { kind: "in-work-copies", copies: [] },
    { kind: "in-work-copies" },
    { kind: "in-work-copies", copies: [{ slug: "-w2" }] },
    { kind: "in-work-copies", copies: [{ slug: 2, same: true }] },
  ])("refuses %j", (issue) => {
    expect(isLibraryMemoryHealth(withIssue(issue))).toBe(false);
  });
});
