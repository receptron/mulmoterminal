import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, confirmLock, decideLock, holdsLock, processIsAlive } from "../../../server/blueprint/executorLock";

const self = { pid: 100, port: "34999", token: "self-token" };
const other = { pid: 200, port: "34567", token: "other-token" };
const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

describe("decideLock", () => {
  it("takes a lock nobody holds", () => {
    expect(decideLock(null, self, alive([]))).toEqual({ kind: "take" });
  });

  it("leaves a lock held by another live server, naming it", () => {
    expect(decideLock(other, self, alive([200]))).toEqual({ kind: "held", holder: other });
  });

  it("takes a lock whose holder has died", () => {
    expect(decideLock(other, self, alive([]))).toEqual({ kind: "take" });
  });

  it("keeps its own lock", () => {
    expect(decideLock(self, self, alive([100]))).toEqual({ kind: "take" });
  });

  it("does not mistake a lock written under the same pid by an earlier start for its own", () => {
    const earlierStart = { ...self, token: "earlier-token" };
    expect(decideLock(earlierStart, self, alive([100]))).toEqual({ kind: "held", holder: earlierStart });
  });

  it.each([
    ["a string"],
    [{ pid: "200", port: "1" }],
    [{ pid: 0, port: "1" }],
    [{ pid: -3, port: "1" }],
    [{ pid: 1.5, port: "1" }],
    [{ pid: 200 }],
    [{ pid: 200, port: "1" }],
    [{ pid: 200, port: "1", token: "" }],
    [[]],
  ])("treats a malformed lock (%j) as free", (existing) => {
    expect(decideLock(existing, self, () => true)).toEqual({ kind: "take" });
  });
});

describe("processIsAlive", () => {
  it("is true for this process and false for a pid nothing uses", () => {
    expect(processIsAlive(process.pid)).toBe(true);
    expect(processIsAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe("acquireLock", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "bp-lock-"));
    file = path.join(dir, "executor.lock");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the lock and records who holds it", async () => {
    expect(await acquireLock(file, self, alive([]))).toEqual({ kind: "take" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(self);
  });

  it("refuses while another live server holds it, and leaves the file alone", async () => {
    await writeFile(file, JSON.stringify(other));
    expect(await acquireLock(file, self, alive([200]))).toEqual({ kind: "held", holder: other });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(other);
  });

  it("replaces a dead holder's lock with its own", async () => {
    await writeFile(file, JSON.stringify(other));
    expect(await acquireLock(file, self, alive([]))).toEqual({ kind: "take" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(self);
  });

  it("replaces an unreadable lock", async () => {
    await writeFile(file, "not json");
    expect(await acquireLock(file, self, alive([]))).toEqual({ kind: "take" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(self);
  });

  it("lets exactly one of two servers starting together take it", async () => {
    const results = await Promise.all([acquireLock(file, self, alive([100, 200])), acquireLock(file, other, alive([100, 200]))]);
    expect(results.filter((result) => result.kind === "take")).toHaveLength(1);
  });

  it("gives up with the file named when a stale lock cannot be replaced", async () => {
    await writeFile(file, JSON.stringify(other));
    await expect(acquireLock(file, self, alive([]), 1)).rejects.toThrow(file);
  });
});

describe("holdsLock", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "bp-holds-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is true only while the file names this server's token", async () => {
    const file = path.join(dir, "executor.lock");
    expect(await holdsLock(file, self)).toBe(false);
    await acquireLock(file, self, alive([]));
    expect(await holdsLock(file, self)).toBe(true);
    await writeFile(file, JSON.stringify(other));
    expect(await holdsLock(file, self)).toBe(false);
  });
});

describe("confirmLock", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "bp-confirm-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports the server that won a race to replace a stale lock, not the one that wrote first", async () => {
    const file = path.join(dir, "executor.lock");
    await writeFile(file, JSON.stringify(self));
    expect(await confirmLock(file, self)).toEqual({ kind: "take" });
    await writeFile(file, JSON.stringify(other));
    expect(await confirmLock(file, self)).toEqual({ kind: "held", holder: other });
  });

  it("gives up with the file named when the lock is gone or unreadable", async () => {
    const file = path.join(dir, "executor.lock");
    await expect(confirmLock(file, self)).rejects.toThrow(file);
    await writeFile(file, "not json");
    await expect(confirmLock(file, self)).rejects.toThrow(file);
  });
});
