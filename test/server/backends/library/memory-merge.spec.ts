// @vitest-environment node
// Merging one memory into another (#3331): the merged text written over the one that stays, the other
// to the Trash with its MEMORY.md lines, and both put back by one Undo.
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeMemory, restoreMemory, type MemoryMergeResult } from "../../../../server/backends/library/memory-trash";
import { memoryVersion, replaceKeepingMode } from "../../../../server/backends/library/memory-write";
import { trashEntry, type TrashLayout } from "../../../../server/files/tree-ops";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const INDEX = "# Memory\n- [A](a.md) — one\n- [B](b.md) — two\n";
const NOW = new Date("2026-11-21T00:00:00Z");
const MERGED = "beta\n\nalpha";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "mt-memory-merge-"));
  dirs.push(root);
  const memory = path.join(root, "-w-app", "memory");
  mkdirSync(memory, { recursive: true });
  writeFileSync(path.join(memory, "MEMORY.md"), INDEX);
  writeFileSync(path.join(memory, "a.md"), "alpha");
  writeFileSync(path.join(memory, "b.md"), "beta");
  const layout: NonNullable<TrashLayout> = { kind: "mac", files: path.join(root, "Trash") };
  const read = (name: string): string => readFileSync(path.join(memory, name), "utf8");
  const trashed = (): string[] => (existsSync(layout.files) ? readdirSync(layout.files) : []);
  /** a.md merged into b.md, each at the version given (their own by default). */
  const merge = (versions: { into?: string; from?: string } = {}) => ({
    into: path.join(memory, "b.md"),
    text: MERGED,
    intoVersion: versions.into ?? memoryVersion("beta"),
    from: path.join(memory, "a.md"),
    fromVersion: versions.from ?? memoryVersion("alpha"),
  });
  return { memory, layout, read, trashed, merge };
}

const undoOf = (result: MemoryMergeResult): string => {
  if (result.kind !== "merged") throw new Error(`not merged: ${result.kind}`);
  return result.undo;
};

describe("mergeMemory", () => {
  it("writes the merged text, moves the other memory and its index line to the Trash, and Undo puts both back", async () => {
    const { layout, read, trashed, merge, memory } = setup();
    const result = await mergeMemory(merge(), layout, NOW);
    expect(result).toEqual({ kind: "merged", version: memoryVersion(MERGED), undo: undoOf(result) });
    expect(read("b.md")).toBe(MERGED);
    expect(existsSync(path.join(memory, "a.md"))).toBe(false);
    expect(trashed()).toEqual(["a.md"]);
    expect(read("MEMORY.md")).toBe("# Memory\n- [B](b.md) — two\n");
    expect(await restoreMemory(undoOf(result), NOW)).toBe("restored");
    expect([read("a.md"), read("b.md"), read("MEMORY.md")]).toEqual(["alpha", "beta", INDEX]);
    expect(trashed()).toEqual([]);
  });
  it("changes nothing when either memory changed since it was opened", async () => {
    const { layout, read, trashed, merge } = setup();
    expect(await mergeMemory(merge({ into: memoryVersion("older") }), layout, NOW)).toEqual({ kind: "conflict", file: "into" });
    expect(await mergeMemory(merge({ from: memoryVersion("older") }), layout, NOW)).toEqual({ kind: "conflict", file: "from" });
    expect([read("a.md"), read("b.md"), read("MEMORY.md")]).toEqual(["alpha", "beta", INDEX]);
    expect(trashed()).toEqual([]);
  });
  it("puts the other memory back when the merged text cannot be written", async () => {
    const { layout, read, trashed, merge } = setup();
    const failing = () => Promise.reject(new Error("disk full"));
    // The index is written by the delete before the merged text fails; only the text write fails.
    let writes = 0;
    const replace = (file: string, text: string, mode: number) => (++writes === 2 ? failing() : replaceKeepingMode(file, text, mode));
    await expect(mergeMemory(merge(), layout, NOW, { replace, move: trashEntry })).rejects.toThrow("disk full");
    expect([read("a.md"), read("b.md"), read("MEMORY.md")]).toEqual(["alpha", "beta", INDEX]);
    expect(trashed()).toEqual([]);
  });
  it("on Undo, keeps a text written over the merge since, and still puts the other memory back", async () => {
    const { layout, read, merge, memory } = setup();
    const undo = undoOf(await mergeMemory(merge(), layout, NOW));
    writeFileSync(path.join(memory, "b.md"), "the agent's newer text");
    expect(await restoreMemory(undo, NOW)).toBe("restored");
    expect([read("a.md"), read("b.md")]).toEqual(["alpha", "the agent's newer text"]);
  });
  it("leaves the merged text when the other memory cannot come back", async () => {
    const { layout, read, merge, memory } = setup();
    const undo = undoOf(await mergeMemory(merge(), layout, NOW));
    writeFileSync(path.join(memory, "a.md"), "a new a.md");
    expect(await restoreMemory(undo, NOW)).toBe("taken");
    expect([read("a.md"), read("b.md")]).toEqual(["a new a.md", MERGED]);
  });
  it("takes two merges in opposite directions in turn, without either waiting on the other", async () => {
    const { layout, read, memory } = setup();
    const a = path.join(memory, "a.md");
    const b = path.join(memory, "b.md");
    const results = await Promise.all([
      mergeMemory({ into: b, text: MERGED, intoVersion: memoryVersion("beta"), from: a, fromVersion: memoryVersion("alpha") }, layout, NOW),
      mergeMemory({ into: a, text: "alpha\n\nbeta", intoVersion: memoryVersion("alpha"), from: b, fromVersion: memoryVersion("beta") }, layout, NOW),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["conflict", "merged"]);
    expect(read("MEMORY.md").split("\n")).toHaveLength(3);
  });
});
