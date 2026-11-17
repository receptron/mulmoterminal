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

describe("a folder swapped for a link out while a write makes its parent folders", () => {
  // The swap lands on the first mkdir below the root, made the way the code before this change made
  // it (`fs.promises.mkdir`, recursive) or the way it is made now (`fs.mkdirSync`, one level).
  it("stops at the first level that landed outside: one empty folder there, nothing written", async () => {
    const { ops, root, outside, swapOut, cleanup } = layout();
    const swapped = { done: false };
    const swapOnceBelowRoot = (target: unknown) => {
      if (swapped.done || path.resolve(String(target)) === root) return;
      swapped.done = true;
      swapOut();
    };
    const mkdirSync = fs.mkdirSync;
    vi.spyOn(fs, "mkdirSync").mockImplementation((...args: Parameters<typeof fs.mkdirSync>) => {
      swapOnceBelowRoot(args[0]);
      return mkdirSync(...args);
    });
    const mkdir = fs.promises.mkdir;
    vi.spyOn(fs.promises, "mkdir").mockImplementation((...args: Parameters<typeof fs.promises.mkdir>) => {
      swapOnceBelowRoot(args[0]);
      return mkdir(...args);
    });
    await expect(ops.write("docs/new/deeper/b.md", "redirected")).rejects.toThrow(/escapes its root/);
    expect(readdirSync(path.join(outside, "new"))).toEqual([]);
    cleanup();
  });
});

// A listing or a stat has no descriptor to compare: the check asked again afterwards refuses one taken
// through a folder swapped for a link out, while the swap is still in place.
describe("a folder swapped for a link out while readDir or stat reads it", () => {
  it("readDir throws, and returns none of the outside names", async () => {
    const { ops, swapOut, cleanup } = layout();
    const readdir = fs.promises.readdir;
    vi.spyOn(fs.promises, "readdir").mockImplementationOnce((...args: Parameters<typeof fs.promises.readdir>) => {
      swapOut();
      return readdir(...args);
    });
    await expect(ops.readDir("docs")).rejects.toThrow(/escapes its root/);
    cleanup();
  });

  it("stat throws, and returns nothing about the outside file", async () => {
    const { ops, swapOut, cleanup } = layout();
    const stat = fs.promises.stat;
    vi.spyOn(fs.promises, "stat").mockImplementationOnce((...args: Parameters<typeof fs.promises.stat>) => {
      swapOut();
      return stat(...args);
    });
    await expect(ops.stat("docs/a.md")).rejects.toThrow(/escapes its root/);
    cleanup();
  });

  it("both still answer when nothing moves", async () => {
    const { ops, cleanup } = layout();
    expect(await ops.readDir("docs")).toEqual(["a.md"]);
    expect((await ops.stat("docs/a.md")).size).toBe("inside".length);
    cleanup();
  });
});
