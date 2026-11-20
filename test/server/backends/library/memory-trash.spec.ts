// @vitest-environment node
// Deleting a memory to the Trash with its MEMORY.md lines, and undoing it (#3331).
import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEMORY_UNDO_KEEP_MS, restoreMemory, trashMemory } from "../../../../server/backends/library/memory-trash";
import { replaceKeepingMode } from "../../../../server/backends/library/memory-write";
import { trashEntry, type TrashLayout } from "../../../../server/files/tree-ops";
import { memoryVersion } from "../../../../server/backends/library/memory-write";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const INDEX = "# Memory\n- [A](a.md) — one\n- [B](b.md) — two\n";
const NOW = new Date("2026-11-20T00:00:00Z");

function setup(kind: "mac" | "freedesktop" = "mac", index: string | null = INDEX) {
  const root = mkdtempSync(path.join(tmpdir(), "mt-memory-trash-"));
  dirs.push(root);
  const memory = path.join(root, "-w-app", "memory");
  mkdirSync(memory, { recursive: true });
  if (index !== null) writeFileSync(path.join(memory, "MEMORY.md"), index);
  writeFileSync(path.join(memory, "a.md"), "alpha");
  writeFileSync(path.join(memory, "b.md"), "beta");
  const trash = path.join(root, "Trash");
  const layout: NonNullable<TrashLayout> = kind === "mac" ? { kind, files: trash } : { kind, files: path.join(trash, "files"), info: path.join(trash, "info") };
  const read = (name: string): string => readFileSync(path.join(memory, name), "utf8");
  return { memory, layout, read, file: path.join(memory, "a.md"), trashed: () => readdirSync(layout.files) };
}

const undoOf = (result: Awaited<ReturnType<typeof trashMemory>>): string => {
  if (result.kind !== "trashed") throw new Error(`not trashed: ${result.kind}`);
  return result.undo;
};

describe("trashMemory", () => {
  it("moves the file to the Trash and takes its lines out of MEMORY.md", async () => {
    const { file, layout, read, trashed } = setup();
    expect((await trashMemory(file, memoryVersion("alpha"), layout, NOW)).kind).toBe("trashed");
    expect(existsSync(file)).toBe(false);
    expect(trashed()).toEqual(["a.md"]);
    expect(read("MEMORY.md")).toBe("# Memory\n- [B](b.md) — two\n");
  });
  it("leaves both alone when the memory changed since it was opened, or is gone", async () => {
    const { file, layout, read, trashed } = setup();
    expect(await trashMemory(file, memoryVersion("older"), layout, NOW)).toEqual({ kind: "conflict", version: memoryVersion("alpha") });
    expect(read("a.md")).toBe("alpha");
    expect(read("MEMORY.md")).toBe(INDEX);
    expect(existsSync(layout.files) ? trashed() : []).toEqual([]);
    rmSync(file);
    expect(await trashMemory(file, memoryVersion("alpha"), layout, NOW)).toEqual({ kind: "conflict", version: null });
  });
  it("refuses a memory whose index it could not rewrite faithfully, leaving both in place", async () => {
    const { file, layout, read, memory } = setup();
    writeFileSync(path.join(memory, "MEMORY.md"), Buffer.from([0x2d, 0x20, 0xff, 0x0a]));
    expect(await trashMemory(file, memoryVersion("alpha"), layout, NOW)).toEqual({ kind: "refused" });
    expect(read("a.md")).toBe("alpha");
  });
  it("deletes a memory when there is no index, and writes none", async () => {
    const { file, layout, memory } = setup("mac", null);
    expect((await trashMemory(file, memoryVersion("alpha"), layout, NOW)).kind).toBe("trashed");
    expect(existsSync(path.join(memory, "MEMORY.md"))).toBe(false);
  });
  it("leaves the index's bytes alone when it does not list the memory", async () => {
    const { file, layout, read, memory } = setup("mac", "- [B](b.md)\r\n");
    const before = statSync(path.join(memory, "MEMORY.md")).ino;
    await trashMemory(file, memoryVersion("alpha"), layout, NOW);
    expect(read("MEMORY.md")).toBe("- [B](b.md)\r\n");
    expect(statSync(path.join(memory, "MEMORY.md")).ino).toBe(before);
  });
  it("keeps the index's mode", async () => {
    const { file, layout, memory } = setup();
    chmodSync(path.join(memory, "MEMORY.md"), 0o600);
    await trashMemory(file, memoryVersion("alpha"), layout, NOW);
    expect(statSync(path.join(memory, "MEMORY.md")).mode & 0o777).toBe(0o600);
  });
  it("writes the freedesktop info file that lets a file manager put it back", async () => {
    const { file, layout } = setup("freedesktop");
    await trashMemory(file, memoryVersion("alpha"), layout, NOW);
    if (layout.kind !== "freedesktop") throw new Error("layout");
    expect(readFileSync(path.join(layout.info, "a.md.trashinfo"), "utf8")).toContain(`Path=${file}`);
  });
  it("puts the memory back when the index cannot be written, so the two never disagree", async () => {
    const { file, layout, read, trashed } = setup();
    const failing = () => Promise.reject(new Error("disk full"));
    await expect(trashMemory(file, memoryVersion("alpha"), layout, NOW, { replace: failing, move: trashEntry })).rejects.toThrow("disk full");
    expect(read("a.md")).toBe("alpha");
    expect(read("MEMORY.md")).toBe(INDEX);
    expect(trashed()).toEqual([]);
  });
});

describe("trashMemory, when the agent writes between the check and the move", () => {
  /** The move, with `before` run just before it — where the agent's write would land. */
  const movingAfter = (before: () => void) => ({
    replace: replaceKeepingMode,
    move: (...args: Parameters<typeof trashEntry>) => {
      before();
      return trashEntry(...args);
    },
  });

  it("puts back a memory that changed, and says it changed", async () => {
    const { file, layout, read, trashed } = setup();
    const result = await trashMemory(
      file,
      memoryVersion("alpha"),
      layout,
      NOW,
      movingAfter(() => writeFileSync(file, "the agent's newer text")),
    );
    expect(result).toEqual({ kind: "conflict", version: memoryVersion("the agent's newer text") });
    expect(read("a.md")).toBe("the agent's newer text");
    expect(read("MEMORY.md")).toBe(INDEX);
    expect(trashed()).toEqual([]);
  });
  it("edits the index as it is after the move, keeping a line the agent added", async () => {
    const { file, layout, read, memory } = setup();
    const added = () => writeFileSync(path.join(memory, "MEMORY.md"), `${INDEX}- [C](c.md) — the agent's\n`);
    expect((await trashMemory(file, memoryVersion("alpha"), layout, NOW, movingAfter(added))).kind).toBe("trashed");
    expect(read("MEMORY.md")).toBe("# Memory\n- [B](b.md) — two\n- [C](c.md) — the agent's\n");
  });
  it("leaves the index's lines for a memory made at that name right after the move", async () => {
    const { file, layout, read, trashed } = setup();
    const remade = {
      replace: replaceKeepingMode,
      move: (...args: Parameters<typeof trashEntry>) => {
        const landed = trashEntry(...args);
        writeFileSync(file, "the agent's new a.md");
        return landed;
      },
    };
    expect((await trashMemory(file, memoryVersion("alpha"), layout, NOW, remade)).kind).toBe("trashed");
    expect(read("a.md")).toBe("the agent's new a.md");
    expect(read("MEMORY.md")).toBe(INDEX);
    expect(trashed()).toEqual(["a.md"]);
  });
  it("puts back what reached the Trash when it is not the file identified before the move", async () => {
    const { file, layout, read, trashed } = setup();
    const swapped = {
      replace: replaceKeepingMode,
      move: (...args: Parameters<typeof trashEntry>) => ({ ...trashEntry(...args), outcome: "escaped" as const }),
    };
    expect(await trashMemory(file, memoryVersion("alpha"), layout, NOW, swapped)).toEqual({ kind: "conflict", version: memoryVersion("alpha") });
    expect(read("a.md")).toBe("alpha");
    expect(read("MEMORY.md")).toBe(INDEX);
    expect(trashed()).toEqual([]);
  });
  it("puts the memory back when the index became one it cannot rewrite", async () => {
    const { file, layout, read, memory, trashed } = setup();
    const garbled = () => writeFileSync(path.join(memory, "MEMORY.md"), Buffer.from([0x2d, 0x20, 0xff, 0x0a]));
    await expect(trashMemory(file, memoryVersion("alpha"), layout, NOW, movingAfter(garbled))).rejects.toThrow("unreadable");
    expect(read("a.md")).toBe("alpha");
    expect(trashed()).toEqual([]);
  });
});

describe("restoreMemory", () => {
  it("never removes a file the agent put at that name while a failed undo was writing the index", async () => {
    const { file, layout, read, memory } = setup();
    const undo = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    const replacedThenFailed = async () => {
      writeFileSync(path.join(memory, "agent.tmp"), "the agent's a.md");
      renameSync(path.join(memory, "agent.tmp"), file);
      throw new Error("disk full");
    };
    await expect(restoreMemory(undo, NOW, replacedThenFailed)).rejects.toThrow("disk full");
    expect(read("a.md")).toBe("the agent's a.md");
  });
  it("leaves the memory in the Trash when its index line cannot be written, and can be tried again", async () => {
    const { file, layout, read, trashed } = setup();
    const undo = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    await expect(restoreMemory(undo, NOW, () => Promise.reject(new Error("disk full")))).rejects.toThrow("disk full");
    expect(existsSync(file)).toBe(false);
    expect(trashed()).toEqual(["a.md"]);
    expect(await restoreMemory(undo, NOW)).toBe("restored");
    expect(read("a.md")).toBe("alpha");
    expect(read("MEMORY.md")).toBe(INDEX);
  });
  it("puts the file and the index back as they were", async () => {
    const { file, layout, read, trashed } = setup();
    const undo = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    expect(await restoreMemory(undo, NOW)).toBe("restored");
    expect(read("a.md")).toBe("alpha");
    expect(read("MEMORY.md")).toBe(INDEX);
    expect(trashed()).toEqual([]);
  });
  it("removes the freedesktop info file with the entry", async () => {
    const { file, layout } = setup("freedesktop");
    await restoreMemory(undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW)), NOW);
    if (layout.kind !== "freedesktop") throw new Error("layout");
    expect(readdirSync(layout.info)).toEqual([]);
  });
  it("adds the lines at the end when the index changed since, and not twice", async () => {
    const { file, layout, read, memory } = setup();
    const undo = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    writeFileSync(path.join(memory, "MEMORY.md"), "# Memory\n- [B](b.md) — two\n- [C](c.md) — the agent's\n");
    await restoreMemory(undo, NOW);
    expect(read("MEMORY.md")).toBe("# Memory\n- [B](b.md) — two\n- [C](c.md) — the agent's\n- [A](a.md) — one\n");
  });
  it("never replaces a file made at that name since", async () => {
    const { file, layout, read, trashed } = setup();
    const undo = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    writeFileSync(file, "the agent wrote a new one");
    expect(await restoreMemory(undo, NOW)).toBe("taken");
    expect(read("a.md")).toBe("the agent wrote a new one");
    expect(trashed()).toEqual(["a.md"]);
  });
  it("is done once: a second undo, an unknown id and an old one are gone", async () => {
    const { file, layout } = setup();
    const undo = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    const [first, second] = await Promise.all([restoreMemory(undo, NOW), restoreMemory(undo, NOW)]);
    expect([first, second]).toEqual(["restored", "gone"]);
    expect(await restoreMemory("00000000-0000-0000-0000-000000000000", NOW)).toBe("gone");
    const late = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    expect(await restoreMemory(late, new Date(NOW.getTime() + MEMORY_UNDO_KEEP_MS + 1))).toBe("gone");
  });
  it("is gone when the Trash was emptied", async () => {
    const { file, layout } = setup();
    const undo = undoOf(await trashMemory(file, memoryVersion("alpha"), layout, NOW));
    rmSync(layout.files, { recursive: true });
    expect(await restoreMemory(undo, NOW)).toBe("gone");
    expect(await restoreMemory(undo, NOW)).toBe("gone");
  });
  it("takes two deletes of one memory in turn: the second finds it gone", async () => {
    const { file, layout, read } = setup();
    const results = await Promise.all([trashMemory(file, memoryVersion("alpha"), layout, NOW), trashMemory(file, memoryVersion("alpha"), layout, NOW)]);
    expect(results.map((result) => result.kind).sort()).toEqual(["conflict", "trashed"]);
    expect(read("MEMORY.md")).toBe("# Memory\n- [B](b.md) — two\n");
  });
});
