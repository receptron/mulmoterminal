// @vitest-environment node
// Merging one memory into another (#3331): the merged text written over the one that stays, the other
// to the Trash with its MEMORY.md lines, and both put back by one Undo.
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeMemory, restoreMemory, type MemoryMergeResult } from "../../../../server/backends/library/memory-trash";
import { memoryVersion, replaceKeepingMode, writeMemory } from "../../../../server/backends/library/memory-write";
import { linksTo } from "../../../../server/backends/library/memory-merge-links";
import { memoryHealth } from "../../../../server/backends/library/memory-health";
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
    expect(result).toEqual({ kind: "merged", version: memoryVersion(MERGED), undo: undoOf(result), links: 0, text: MERGED });
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
  it("writes nothing over the memory kept when it changed while the other was moved, and puts that one back", async () => {
    const { layout, read, trashed, merge, memory } = setup();
    const writingB: typeof trashEntry = (...args) => {
      const landed = trashEntry(...args);
      writeFileSync(path.join(memory, "b.md"), "the agent's newer text");
      return landed;
    };
    expect(await mergeMemory(merge(), layout, NOW, { replace: replaceKeepingMode, move: writingB })).toEqual({ kind: "conflict", file: "into" });
    expect([read("a.md"), read("b.md"), read("MEMORY.md")]).toEqual(["alpha", "the agent's newer text", INDEX]);
    expect(trashed()).toEqual([]);
  });
  it("keeps the Undo when the memory kept cannot be put back, and a retry puts it back", async () => {
    const { layout, read, merge, trashed } = setup();
    const undo = undoOf(await mergeMemory(merge(), layout, NOW));
    const failingOnB = (file: string, text: string, mode: number) =>
      file.endsWith("b.md") ? Promise.reject(new Error("disk full")) : replaceKeepingMode(file, text, mode);
    await expect(restoreMemory(undo, NOW, failingOnB)).rejects.toThrow("disk full");
    expect([read("a.md"), read("b.md"), read("MEMORY.md")]).toEqual(["alpha", MERGED, INDEX]);
    expect(trashed()).toEqual([]);
    expect(await restoreMemory(undo, NOW)).toBe("restored");
    expect([read("a.md"), read("b.md"), read("MEMORY.md")]).toEqual(["alpha", "beta", INDEX]);
    expect(await restoreMemory(undo, NOW)).toBe("gone");
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

describe("the links a merge points at the memory that stays", () => {
  const A = "---\nname: alpha\n---\nAlpha body.\n";
  const B = "---\nname: beta\n---\nBeta body.\n";
  const C = "See [[alpha]] and [[a]], not `[[alpha]]`.\n\n```\n[[alpha]]\n```\n";
  const D = "Also [[ alpha ]].\r\n```\r\n[[alpha]]\r\n```\r\n";

  function linked(extra: Record<string, string | Buffer> = {}) {
    const { memory, layout, read, trashed } = setup();
    const files: Record<string, string | Buffer> = { "a.md": A, "b.md": B, "c.md": C, "d.md": D, ...extra };
    Object.entries(files).forEach(([name, text]) => writeFileSync(path.join(memory, name), text));
    const merge = (text = `${B}\nAlpha body.\n`, fromVersion = memoryVersion(A)) => ({
      into: path.join(memory, "b.md"),
      text,
      intoVersion: memoryVersion(B),
      from: path.join(memory, "a.md"),
      fromVersion,
    });
    return { memory, layout, read, trashed, merge };
  }

  it("rewrites the links outside code in every other memory and in the merged text, and says how many", async () => {
    const { layout, read, merge } = linked();
    const result = await mergeMemory(merge(`${B}\nAs [[alpha]] said.\n`), layout, NOW);
    expect(result).toMatchObject({ kind: "merged", links: 4, text: `${B}\nAs [[beta]] said.\n` });
    expect(read("b.md")).toBe(`${B}\nAs [[beta]] said.\n`);
    expect(read("c.md")).toBe("See [[beta]] and [[beta]], not `[[alpha]]`.\n\n```\n[[alpha]]\n```\n");
    expect(read("d.md")).toBe("Also [[beta]].\r\n```\r\n[[alpha]]\r\n```\r\n");
  });

  it("leaves nothing for the health check to call a broken link", async () => {
    const { layout, read, merge } = linked();
    await mergeMemory(merge(), layout, NOW);
    const files = ["b.md", "c.md", "d.md"].map((file) => ({ file, text: read(file) }));
    const health = memoryHealth({ slug: "-w-app", index: { text: read("MEMORY.md"), lines: 2, bytes: 0 }, files }, new Set());
    expect(
      Object.values(health.files)
        .flat()
        .filter((issue) => issue.kind === "broken-link"),
    ).toEqual([]);
  });

  it("puts every rewritten link back on Undo, except in a memory changed since", async () => {
    const { layout, read, merge, memory } = linked();
    const result = await mergeMemory(merge(), layout, NOW);
    writeFileSync(path.join(memory, "d.md"), "rewritten again by the agent [[beta]]\n");
    expect(await restoreMemory(undoOf(result), NOW)).toBe("restored");
    expect([read("a.md"), read("b.md"), read("c.md")]).toEqual([A, B, C]);
    expect(read("d.md")).toBe("rewritten again by the agent [[beta]]\n");
  });

  it("writes nothing when a link to the merged memory cannot be rewritten exactly, and names the files", async () => {
    const mixed = "[[alpha]]\r\n`[[alpha]]`\n";
    const unfaithful = Buffer.concat([Buffer.from("[[alpha]] "), Buffer.from([0xff])]);
    const { layout, read, trashed, merge } = linked({ "e.md": mixed, "f.md": unfaithful, "g.md": "mixed but no link\r\n`x`\n" });
    expect(await mergeMemory(merge(), layout, NOW)).toEqual({ kind: "links-unplaceable", files: ["e.md", "f.md"] });
    expect([read("a.md"), read("b.md"), read("c.md"), read("MEMORY.md"), trashed()]).toEqual([A, B, C, INDEX, []]);
  });

  it("puts everything back when a rewritten memory cannot be written", async () => {
    const { layout, read, trashed, merge } = linked();
    const failOnD = async (target: string, text: string, mode: number): Promise<void> => {
      if (path.basename(target) === "d.md") throw new Error(`no write: ${target}`);
      await replaceKeepingMode(target, text, mode);
    };
    await expect(mergeMemory(merge(), layout, NOW, { replace: failOnD, move: trashEntry })).rejects.toThrow("no write");
    expect([read("a.md"), read("b.md"), read("c.md"), read("d.md"), read("MEMORY.md"), trashed()]).toEqual([A, B, C, D, INDEX, []]);
  });

  it("puts everything back only once no rewrite is still being written", async () => {
    const { layout, read, trashed, merge } = linked();
    const slowCFailingD = async (target: string, text: string, mode: number): Promise<void> => {
      if (path.basename(target) === "d.md") throw new Error(`no write: ${target}`);
      if (path.basename(target) === "c.md") await new Promise((resolve) => setTimeout(resolve, 200));
      await replaceKeepingMode(target, text, mode);
    };
    await expect(mergeMemory(merge(), layout, NOW, { replace: slowCFailingD, move: trashEntry })).rejects.toThrow("no write");
    await new Promise((resolve) => setTimeout(resolve, 300)); // a write still under way would land by now
    expect([read("a.md"), read("b.md"), read("c.md"), read("d.md"), read("MEMORY.md"), trashed()]).toEqual([A, B, C, D, INDEX, []]);
  });

  it("leaves a memory made after it listed the folder as it is: its turn is not held", async () => {
    const { layout, read, merge, memory } = linked();
    const gate: { open: () => void } = { open: () => undefined };
    const held = new Promise<void>((resolve) => (gate.open = resolve));
    const slow = async (target: string, text: string, mode: number): Promise<void> => {
      await held;
      await replaceKeepingMode(target, text, mode);
    };
    const save = writeMemory(path.join(memory, "c.md"), "C again [[alpha]]\n", memoryVersion(C), slow);
    const merged = mergeMemory(merge(), layout, NOW); // lists the folder, then waits for c.md
    await new Promise((resolve) => setTimeout(resolve, 50));
    writeFileSync(path.join(memory, "x.md"), "Made since [[alpha]].\n");
    gate.open();
    expect([(await save).kind, (await merged).kind]).toEqual(["written", "merged"]);
    expect(read("x.md")).toBe("Made since [[alpha]].\n");
    expect(read("c.md")).toBe("C again [[beta]]\n");
  });

  it("leaves a link in a frontmatter value as it is, and does not count it", async () => {
    const withFrontmatter = "---\nname: gamma\ndescription: grew out of [[alpha]]\n---\nSee [[alpha]].\n";
    const { layout, read, merge } = linked({ "c.md": withFrontmatter });
    expect(await mergeMemory(merge(), layout, NOW)).toMatchObject({ kind: "merged", links: 2 });
    expect(read("c.md")).toBe("---\nname: gamma\ndescription: grew out of [[alpha]]\n---\nSee [[beta]].\n");
  });

  it("leaves a link by a name another memory has too: it still means that one", async () => {
    const { layout, read, merge } = linked({ "z.md": "---\nname: alpha\n---\nAnother alpha.\n" });
    expect(await mergeMemory(merge(), layout, NOW)).toMatchObject({ kind: "merged", links: 1 });
    expect(read("c.md")).toBe("See [[alpha]] and [[beta]], not `[[alpha]]`.\n\n```\n[[alpha]]\n```\n");
    expect(read("d.md")).toBe(D);
  });

  it("stops and puts everything back when another process writes a memory whose links it was rewriting", async () => {
    const { layout, read, trashed, merge, memory } = linked();
    const agentWritesC = async (target: string, text: string, mode: number): Promise<void> => {
      await replaceKeepingMode(target, text, mode);
      // The agent writes c.md just after the merge wrote the memory kept: no turn held here keeps it out.
      if (path.basename(target) === "b.md" && text !== B) writeFileSync(path.join(memory, "c.md"), "the agent's [[alpha]]\n");
    };
    expect(await mergeMemory(merge(), layout, NOW, { replace: agentWritesC, move: trashEntry })).toEqual({ kind: "conflict", file: "links" });
    expect([read("a.md"), read("b.md"), read("c.md"), read("d.md"), read("MEMORY.md"), trashed()]).toEqual([A, B, "the agent's [[alpha]]\n", D, INDEX, []]);
  });

  it("does not count a link by a name the two memories share, which already reaches the one that stays", async () => {
    const { layout, read, merge } = linked({ "b.md": "---\nname: alpha\n---\nB.\n" });
    const result = await mergeMemory({ ...merge("---\nname: alpha\n---\nB.\n"), intoVersion: memoryVersion("---\nname: alpha\n---\nB.\n") }, layout, NOW);
    expect(result).toMatchObject({ kind: "merged", links: 1 });
    expect(read("c.md")).toBe("See [[alpha]] and [[alpha]], not `[[alpha]]`.\n\n```\n[[alpha]]\n```\n");
  });

  it("holds every memory of the folder, so a save between its read and its write waits and finds it changed", async () => {
    const { layout, read, merge, memory } = linked();
    const gate: { open: () => void } = { open: () => undefined };
    const held = new Promise<void>((resolve) => (gate.open = resolve));
    const slow = async (target: string, text: string, mode: number): Promise<void> => {
      await held;
      await replaceKeepingMode(target, text, mode);
    };
    // The merge has read c.md and waits to write; a save of c.md named on the text it read must not
    // land in between, or the merge's write would then put back the text the save replaced.
    const merged = mergeMemory(merge(), layout, NOW, { replace: slow, move: trashEntry });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const save = writeMemory(path.join(memory, "c.md"), "C again [[alpha]]\n", memoryVersion(C));
    await new Promise((resolve) => setTimeout(resolve, 50));
    gate.open();
    expect([(await merged).kind, (await save).kind]).toEqual(["merged", "conflict"]);
    expect(read("c.md")).toBe("See [[beta]] and [[beta]], not `[[alpha]]`.\n\n```\n[[alpha]]\n```\n");
  });
});

describe("linksTo", () => {
  it("says how many links merging would rewrite into the memory as it is, or which cannot be", async () => {
    const { memory } = setup();
    writeFileSync(path.join(memory, "a.md"), "---\nname: alpha\n---\nA.\n");
    writeFileSync(path.join(memory, "c.md"), "[[alpha]] [[a]] `[[alpha]]`\n");
    expect(await linksTo(path.join(memory, "a.md"), path.join(memory, "b.md"))).toEqual({ count: 2, unplaceable: [] });
    writeFileSync(path.join(memory, "e.md"), "[[a]]\r\n`x`\n");
    expect(await linksTo(path.join(memory, "a.md"), path.join(memory, "b.md"))).toEqual({ count: 0, unplaceable: ["e.md"] });
    expect(await linksTo(path.join(memory, "a.md"), path.join(memory, "gone.md"))).toBeNull();
  });
});
