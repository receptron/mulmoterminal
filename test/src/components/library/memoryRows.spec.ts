// How the Library lists memory (#3331): the index gauge, the search, and where a link goes.
import { describe, it, expect } from "vitest";
import { filterMemory, indexFill, linkTarget, memoryTitle } from "../../../../src/components/library/memoryRows";
import { MEMORY_INDEX_BYTES_MAX, MEMORY_INDEX_LINES_MAX, type LibraryMemoryFile, type LibraryMemoryProject } from "../../../../common/libraryMemory";

const memory = (file: string, over: Partial<LibraryMemoryFile> = {}): LibraryMemoryFile => ({
  file,
  name: null,
  description: null,
  type: null,
  updatedAt: 0,
  ...over,
});
const project = (slug: string, files: LibraryMemoryFile[]): LibraryMemoryProject => ({ slug, cwd: null, index: null, files });

describe("indexFill", () => {
  it("warns past nine tenths of either limit, and not at it", () => {
    expect(indexFill({ lines: 180, bytes: 0 })?.warn).toBe(false);
    expect(indexFill({ lines: 181, bytes: 0 })?.warn).toBe(true);
    expect(indexFill({ lines: 1, bytes: MEMORY_INDEX_BYTES_MAX })).toEqual({ lines: 1, ratio: 1, warn: true });
    expect(indexFill({ lines: MEMORY_INDEX_LINES_MAX * 2, bytes: 0 })?.ratio).toBe(2);
    expect(indexFill(null)).toBeNull();
  });
});

describe("filterMemory", () => {
  const projects = [
    project("a", [memory("x.md", { name: "Reply in Japanese" }), memory("y.md", { description: "codex sandbox" })]),
    project("b", [memory("z.md")]),
  ];

  it("keeps the memories whose name, description or file match, any case, and drops emptied projects", () => {
    expect(filterMemory(projects, "  JAPANESE ").map((p) => [p.slug, p.files.map((f) => f.file)])).toEqual([["a", ["x.md"]]]);
    expect(filterMemory(projects, "z.md").map((p) => p.slug)).toEqual(["b"]);
    expect(filterMemory(projects, "nothing")).toEqual([]);
  });

  it("keeps everything for an empty search", () => {
    expect(filterMemory(projects, "  ")).toEqual(projects);
  });
});

describe("linkTarget and memoryTitle", () => {
  it("finds a link's memory by its name or its file, in the same project only", () => {
    const named = memory("reply.md", { name: "reply-in-japanese" });
    const here = project("a", [named, memory("plain.md")]);
    expect(linkTarget(here, "reply-in-japanese")).toBe(named);
    expect(linkTarget(here, "plain")?.file).toBe("plain.md");
    expect(linkTarget(here, "elsewhere")).toBeNull();
  });

  it("titles a memory by its name, else its file without .md", () => {
    expect(memoryTitle(memory("a.md", { name: "Named" }))).toBe("Named");
    expect(memoryTitle(memory("plain.md"))).toBe("plain");
  });
});
