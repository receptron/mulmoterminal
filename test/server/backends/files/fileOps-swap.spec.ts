// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs, { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { swappableProject } from "../../../support/swappableProject.js";
import { createFileOps } from "../../../../server/backends/files/fileOps.js";

// #3306 for the plugin file operations: `docs` is swapped for a link out after the containment check has
// answered, at the first open, read or write that follows it. Nothing outside may be read or written.
const SECRET = "outside secret";

const layout = () => {
  const project = swappableProject();
  writeFileSync(path.join(project.outside, "a.md"), SECRET);
  return { ...project, ops: createFileOps(() => project.root, "test") };
};

// `open` is what the verified operations use; `readFile` / `writeFile` by name are what came before
// them, so the same swap lands on the code before the fix too.
const swapOutOnFirstFileAccess = (swapOut: () => void) => {
  const swapped = { done: false };
  const swapOnce = () => {
    if (swapped.done) return;
    swapped.done = true;
    swapOut();
  };
  const { open, readFile, writeFile } = fs.promises;
  vi.spyOn(fs.promises, "open").mockImplementation((...args: Parameters<typeof open>) => {
    swapOnce();
    return open(...args);
  });
  vi.spyOn(fs.promises, "readFile").mockImplementation((...args: Parameters<typeof readFile>) => {
    swapOnce();
    return readFile(...args);
  });
  vi.spyOn(fs.promises, "writeFile").mockImplementation((...args: Parameters<typeof writeFile>) => {
    swapOnce();
    return writeFile(...args);
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a folder swapped for a link out between the check and the operation", () => {
  it("read refuses, as a missing file, and returns none of the outside file", async () => {
    const { ops, swapOut, cleanup } = layout();
    swapOutOnFirstFileAccess(swapOut);
    await expect(ops.read("docs/a.md")).rejects.toMatchObject({ code: "ENOENT" });
    cleanup();
  });

  it("readBytes refuses in the same way", async () => {
    const { ops, swapOut, cleanup } = layout();
    swapOutOnFirstFileAccess(swapOut);
    await expect(ops.readBytes("docs/a.md")).rejects.toMatchObject({ code: "ENOENT" });
    cleanup();
  });

  it("write fails, and leaves the outside folder as it was", async () => {
    const { ops, outside, swapOut, cleanup } = layout();
    swapOutOnFirstFileAccess(swapOut);
    await expect(ops.write("docs/a.md", "redirected")).rejects.toThrow();
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe(SECRET);
    expect(readdirSync(outside)).toEqual(["a.md"]);
    cleanup();
  });

  it("still reads and writes when nothing moves", async () => {
    const { ops, root, cleanup } = layout();
    expect(await ops.read("docs/a.md")).toBe("inside");
    await ops.write("docs/a.md", "edited");
    await ops.write("docs/new/b.md", "created");
    expect(readFileSync(path.join(root, "docs", "a.md"), "utf8")).toBe("edited");
    expect(readFileSync(path.join(root, "docs", "new", "b.md"), "utf8")).toBe("created");
    cleanup();
  });
});
