import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, decideLock, processIsAlive } from "../../../server/blueprint/executorLock";

const self = { pid: 100, port: "34999" };
const other = { pid: 200, port: "34567" };
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

  it.each([["a string"], [{ pid: "200", port: "1" }], [{ pid: 0, port: "1" }], [{ pid: -3, port: "1" }], [{ pid: 1.5, port: "1" }], [{ pid: 200 }], [[]]])(
    "treats a malformed lock (%j) as free",
    (existing) => {
      expect(decideLock(existing, self, () => true)).toEqual({ kind: "take" });
    },
  );
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
});
