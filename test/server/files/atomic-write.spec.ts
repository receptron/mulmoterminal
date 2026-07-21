import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "../../../server/files/atomic-write.js";

describe("writeFileAtomic", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-atomic-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes the file", async () => {
    const file = path.join(dir, "state.json");
    await writeFileAtomic(file, '{"a":1}');
    expect(await fs.readFile(file, "utf8")).toBe('{"a":1}');
  });

  it("creates missing parent directories", async () => {
    const file = path.join(dir, "deep", "nested", "state.json");
    await writeFileAtomic(file, "hi");
    expect(await fs.readFile(file, "utf8")).toBe("hi");
  });

  // The point of the rename: readers see the old file or the new one, never a temp.
  it("leaves no temp file behind", async () => {
    await writeFileAtomic(path.join(dir, "state.json"), "hi");
    expect(await fs.readdir(dir)).toEqual(["state.json"]);
  });

  it("replaces existing content rather than appending", async () => {
    const file = path.join(dir, "state.json");
    await writeFileAtomic(file, "first");
    await writeFileAtomic(file, "second");
    expect(await fs.readFile(file, "utf8")).toBe("second");
  });

  // Each call picks a unique temp name, so two writers cannot trample one another's.
  it("survives concurrent writes to the same path", async () => {
    const file = path.join(dir, "state.json");
    await Promise.all([writeFileAtomic(file, "a"), writeFileAtomic(file, "b"), writeFileAtomic(file, "c")]);
    expect(["a", "b", "c"]).toContain(await fs.readFile(file, "utf8"));
    expect(await fs.readdir(dir)).toEqual(["state.json"]);
  });

  it("writes an empty string as an empty file", async () => {
    const file = path.join(dir, "empty.json");
    await writeFileAtomic(file, "");
    expect(await fs.readFile(file, "utf8")).toBe("");
  });
});
