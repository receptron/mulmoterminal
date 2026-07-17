// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFileOps } from "../../../server/backends/fileOps.js";

describe("createFileOps", () => {
  let base: string;
  let root: string;
  let ops: ReturnType<typeof createFileOps>;

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), "mt-fileops-"));
    root = path.join(base, "root");
    mkdirSync(root);
    ops = createFileOps(() => root, "test");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("round-trips a write and a read", async () => {
    await ops.write("note.txt", "hello");
    expect(await ops.read("note.txt")).toBe("hello");
  });

  it("creates missing parent directories on write", async () => {
    await ops.write(path.join("deep", "nested", "note.txt"), "hi");
    expect(await ops.read(path.join("deep", "nested", "note.txt"))).toBe("hi");
  });

  it("reads bytes back as a Uint8Array", async () => {
    await ops.write("bin.dat", "AB");
    expect(Array.from(await ops.readBytes("bin.dat"))).toEqual([65, 66]);
  });

  it("lists a directory and stats a file", async () => {
    await ops.write("a.txt", "12345");
    expect(await ops.readDir("")).toEqual(["a.txt"]);
    const stat = await ops.stat("a.txt");
    expect(stat.size).toBe(5);
    expect(typeof stat.mtimeMs).toBe("number");
  });

  it("reports existence, and unlinks", async () => {
    await ops.write("gone.txt", "x");
    expect(await ops.exists("gone.txt")).toBe(true);
    await ops.unlink("gone.txt");
    expect(await ops.exists("gone.txt")).toBe(false);
  });

  it("treats unlinking a missing file as a no-op", async () => {
    await expect(ops.unlink("never-existed.txt")).resolves.toBeUndefined();
  });

  it("resolves the root per operation, so a workspace injected after binding is honoured", async () => {
    let current = root;
    const late = createFileOps(() => current, "test");
    const moved = path.join(base, "moved");
    mkdirSync(moved);
    await late.write("a.txt", "first");
    current = moved;
    await late.write("a.txt", "second");
    expect(await late.read("a.txt")).toBe("second");
    expect(await ops.read("a.txt")).toBe("first");
  });

  describe("containment guard", () => {
    // The escape must be reported, never silently resolved outside the root.
    const escapes: [string, string][] = [
      ["a parent traversal", path.join("..", "outside.txt")],
      ["a deep traversal", path.join("a", "..", "..", "outside.txt")],
      ["an absolute path", path.join(path.sep, "etc", "passwd")],
    ];
    it.each(escapes)("rejects %s", async (_label, rel) => {
      await expect(ops.read(rel)).rejects.toThrow(/test path escapes its root/);
    });

    // `/base/root-evil` string-prefixes `/base/root` — the guard must compare on a
    // path boundary, not a raw prefix.
    it("rejects a sibling directory that merely prefixes the root name", async () => {
      writeFileSync(path.join(base, "root-evil.txt"), "secret");
      await expect(ops.read(path.join("..", "root-evil.txt"))).rejects.toThrow(/test path escapes its root/);
    });

    it("applies the guard to every operation", async () => {
      const rel = path.join("..", "outside.txt");
      await expect(ops.write(rel, "x")).rejects.toThrow(/escapes its root/);
      await expect(ops.readBytes(rel)).rejects.toThrow(/escapes its root/);
      await expect(ops.readDir(rel)).rejects.toThrow(/escapes its root/);
      await expect(ops.stat(rel)).rejects.toThrow(/escapes its root/);
      await expect(ops.unlink(rel)).rejects.toThrow(/escapes its root/);
      // exists() swallows a missing file, but must not swallow an escape.
      await expect(ops.exists(rel)).rejects.toThrow(/escapes its root/);
    });

    it("allows the root itself", async () => {
      await expect(ops.readDir("")).resolves.toEqual([]);
    });
  });

  // FileOps can't create a symlink itself, but one planted by another process or a
  // dependency must not become an escape hatch out of the sandbox.
  describe("symlink guard", () => {
    it("refuses to read through a symlink that points outside the root", async () => {
      const secret = path.join(base, "secret.txt");
      writeFileSync(secret, "top secret");
      symlinkSync(secret, path.join(root, "leak.txt"));
      await expect(ops.read("leak.txt")).rejects.toThrow(/escapes its root via symlink/);
    });

    it("refuses to write through a symlinked directory that points outside the root", async () => {
      const outside = path.join(base, "outside");
      mkdirSync(outside);
      symlinkSync(outside, path.join(root, "escape"));
      await expect(ops.write(path.join("escape", "planted.txt"), "x")).rejects.toThrow(/escapes its root via symlink/);
    });

    it("applies the symlink guard to every operation", async () => {
      const secret = path.join(base, "secret.txt");
      writeFileSync(secret, "s");
      symlinkSync(secret, path.join(root, "leak.txt"));
      const rel = "leak.txt";
      await expect(ops.readBytes(rel)).rejects.toThrow(/via symlink/);
      await expect(ops.stat(rel)).rejects.toThrow(/via symlink/);
      await expect(ops.unlink(rel)).rejects.toThrow(/via symlink/);
      await expect(ops.exists(rel)).rejects.toThrow(/via symlink/);
    });

    it("allows a symlink that stays inside the root", async () => {
      await ops.write("real.txt", "inside");
      symlinkSync(path.join(root, "real.txt"), path.join(root, "alias.txt"));
      expect(await ops.read("alias.txt")).toBe("inside");
    });
  });
});
