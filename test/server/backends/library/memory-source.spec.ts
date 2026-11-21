// Which conversation wrote a memory (#3331): the memory writes in a transcript record, both ways.
import { describe, it, expect } from "vitest";
import { memoryWriteKey, memoryWritesOf } from "../../../../server/backends/library/memory-source";

describe("memoryWriteKey", () => {
  it.each([
    ["/Users/me/.claude/projects/-Users-me-app/memory/reply-style.md", "-Users-me-app/reply-style.md"],
    ["C:\\Users\\me\\.claude\\projects\\C--Users-me-app\\memory\\notes.md", "C--Users-me-app/notes.md"],
    ["/custom/config/projects/-w-app/memory/a_b.c-d.md", "-w-app/a_b.c-d.md"],
  ])("%s → %s", (filePath, key) => {
    expect(memoryWriteKey(filePath)).toBe(key);
  });
  it.each([
    "/Users/me/.claude/projects/-w-app/memory/MEMORY.md",
    "/Users/me/.claude/projects/-w-app/memory/memory.md",
    "/Users/me/.claude/projects/-w-app/memory/sub/a.md",
    "/Users/me/.claude/projects/-w-app/notes/a.md",
    "/Users/me/.claude/projects/-w-app/memory/a.txt",
    "/Users/me/.claude/projects/-w-app/memory/.hidden.md",
    "/Users/me/.claude/projects/bad slug/memory/a.md",
    "/Users/me/app/memory/a.md",
    "",
  ])("%s is no memory", (filePath) => {
    expect(memoryWriteKey(filePath)).toBeNull();
  });
});

describe("memoryWritesOf", () => {
  const assistant = (...content: unknown[]) => ({ type: "assistant", message: { role: "assistant", content } });
  const tool = (name: string, input: unknown) => ({ type: "tool_use", id: "t", name, input });
  const MEMORY = "/h/.claude/projects/-w-app/memory/a.md";

  it("takes the memories written by Write, Edit and MultiEdit", () => {
    const record = assistant(
      tool("Write", { file_path: MEMORY, content: "x" }),
      tool("Edit", { file_path: MEMORY.replace("a.md", "b.md") }),
      tool("MultiEdit", { file_path: MEMORY.replace("a.md", "c.md") }),
    );
    expect(memoryWritesOf(record)).toEqual(["-w-app/a.md", "-w-app/b.md", "-w-app/c.md"]);
  });
  it("leaves out reads, other files, other records and anything malformed", () => {
    expect(memoryWritesOf(assistant(tool("Read", { file_path: MEMORY })))).toEqual([]);
    expect(memoryWritesOf(assistant(tool("Write", { file_path: "/w/app/src/a.ts" })))).toEqual([]);
    expect(memoryWritesOf(assistant(tool("Write", { file_path: 7 }), tool("Write", null), { type: "text", text: MEMORY }, "x", null))).toEqual([]);
    expect(memoryWritesOf({ type: "user", message: { content: [tool("Write", { file_path: MEMORY })] } })).toEqual([]);
    expect(memoryWritesOf({ type: "assistant", message: { content: "Write" } })).toEqual([]);
    expect(memoryWritesOf({ type: "assistant" })).toEqual([]);
  });
});
