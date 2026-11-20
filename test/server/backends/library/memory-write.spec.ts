// @vitest-environment node
// Writing a memory from the Library (#3331): only over the text the editor opened, never through a link,
// never creating a file.
import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { memoryVersion, writeMemory } from "../../../../server/backends/library/memory-write";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-memory-write-"));
  dirs.push(dir);
  return dir;
};

describe("writeMemory", () => {
  it("writes over the text it was opened on, and answers the new version", async () => {
    const file = path.join(scratch(), "a.md");
    writeFileSync(file, "before");
    expect(await writeMemory(file, "after", memoryVersion("before"))).toEqual({ kind: "written", version: memoryVersion("after") });
    expect(readFileSync(file, "utf8")).toBe("after");
  });

  it("refuses to write over a change made since, and says what is there now", async () => {
    const file = path.join(scratch(), "a.md");
    writeFileSync(file, "the agent's newer text");
    expect(await writeMemory(file, "mine", memoryVersion("what I opened"))).toEqual({ kind: "conflict", version: memoryVersion("the agent's newer text") });
    expect(readFileSync(file, "utf8")).toBe("the agent's newer text");
  });

  it("never creates a file that is gone, and never writes through a link", async () => {
    const dir = scratch();
    const gone = path.join(dir, "gone.md");
    expect(await writeMemory(gone, "x", memoryVersion(""))).toEqual({ kind: "conflict", version: null });
    expect(existsSync(gone)).toBe(false);
    const outside = path.join(dir, "outside.txt");
    writeFileSync(outside, "untouched");
    if (process.platform !== "win32") {
      symlinkSync(outside, path.join(dir, "linked.md"));
      expect(await writeMemory(path.join(dir, "linked.md"), "x", memoryVersion("untouched"))).toEqual({ kind: "refused" });
      expect(readFileSync(outside, "utf8")).toBe("untouched");
    }
  });

  it("lets only one of two saves naming the same version through", async () => {
    const file = path.join(scratch(), "a.md");
    writeFileSync(file, "opened");
    const [first, second] = await Promise.all([writeMemory(file, "one", memoryVersion("opened")), writeMemory(file, "two", memoryVersion("opened"))]);
    expect([first.kind, second.kind].sort()).toEqual(["conflict", "written"]);
    expect(["one", "two"]).toContain(readFileSync(file, "utf8"));
  });

  it.skipIf(process.platform === "win32")("keeps the file's mode", async () => {
    const file = path.join(scratch(), "private.md");
    writeFileSync(file, "kept private", { mode: 0o600 });
    chmodSync(file, 0o600);
    await writeMemory(file, "edited", memoryVersion("kept private"));
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
