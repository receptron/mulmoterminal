import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic, renameWithRetry, isRenameContention } from "../../../server/files/atomic-write.js";

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

// On Windows a rename onto a momentarily-locked destination fails instead of winning the
// race, which made the concurrent write above flaky there. The retry is injected with a
// fake rename so the behaviour is pinned on every platform, not only the one that locks.
const errnoError = (code: string) => Object.assign(new Error(code), { code });

describe("isRenameContention", () => {
  it("accepts the codes Windows reports for a locked destination", () => {
    expect(isRenameContention(errnoError("EPERM"))).toBe(true);
    expect(isRenameContention(errnoError("EACCES"))).toBe(true);
    expect(isRenameContention(errnoError("EBUSY"))).toBe(true);
  });

  it("rejects failures that retrying cannot fix", () => {
    expect(isRenameContention(errnoError("ENOENT"))).toBe(false);
    expect(isRenameContention(errnoError("ENOSPC"))).toBe(false);
  });

  it("rejects errors carrying no errno code", () => {
    expect(isRenameContention(new Error("boom"))).toBe(false);
    expect(isRenameContention(null)).toBe(false);
    expect(isRenameContention("EPERM")).toBe(false);
  });
});

describe("renameWithRetry", () => {
  const noWait = () => Promise.resolve();

  it("renames once when the destination is free", async () => {
    let calls = 0;
    await renameWithRetry(
      "tmp",
      "dest",
      async () => {
        calls++;
      },
      noWait,
    );
    expect(calls).toBe(1);
  });

  it("retries past a transient lock and then succeeds", async () => {
    let calls = 0;
    await renameWithRetry(
      "tmp",
      "dest",
      async () => {
        calls++;
        if (calls < 3) throw errnoError("EPERM");
      },
      noWait,
    );
    expect(calls).toBe(3);
  });

  it("gives up and surfaces the error rather than reporting a write that never landed", async () => {
    let calls = 0;
    const alwaysLocked = async () => {
      calls++;
      throw errnoError("EPERM");
    };
    await expect(renameWithRetry("tmp", "dest", alwaysLocked, noWait)).rejects.toMatchObject({ code: "EPERM" });
    expect(calls).toBeGreaterThan(1);
  });

  it("does not retry an error retrying cannot fix", async () => {
    let calls = 0;
    const missingDir = async () => {
      calls++;
      throw errnoError("ENOENT");
    };
    await expect(renameWithRetry("tmp", "dest", missingDir, noWait)).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
  });

  it("backs off between attempts", async () => {
    const waits: number[] = [];
    let calls = 0;
    await renameWithRetry(
      "tmp",
      "dest",
      async () => {
        calls++;
        if (calls < 3) throw errnoError("EBUSY");
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(waits).toEqual([10, 25]);
  });
});
