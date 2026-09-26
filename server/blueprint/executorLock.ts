// Only one MulmoTerminal on a machine drives blueprint runs. Every instance reads the same run records
// under ~/.mulmoterminal, so two executors would each start sessions for one step and overwrite each
// other's saves — two agents in one folder. The first server to take this lock drives the runs; the
// others still show them, and hand the lock over only once its holder has died.
import { readFile, rm, writeFile } from "node:fs/promises";
import { isRecord } from "../../common/isRecord.js";

export interface LockHolder {
  pid: number;
  port: string;
}

export type LockDecision = { kind: "take" } | { kind: "held"; holder: LockHolder };

const isHolder = (value: unknown): value is LockHolder =>
  isRecord(value) && typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0 && typeof value.port === "string";

/** Pure: whether `self` may drive the runs, given what the lock file holds (as parsed, or null). */
export function decideLock(existing: unknown, self: LockHolder, isAlive: (pid: number) => boolean): LockDecision {
  if (!isHolder(existing) || existing.pid === self.pid || !isAlive(existing.pid)) return { kind: "take" };
  return { kind: "held", holder: existing };
}

export const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else — still alive.
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
};

const readHolder = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
};

const isExists = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "EEXIST";

// Created with `wx`, so of two servers starting together exactly one creates it; a stale lock is
// removed and the creation tried once more.
export async function acquireLock(file: string, self: LockHolder, isAlive: (pid: number) => boolean = processIsAlive, attemptsLeft = 2): Promise<LockDecision> {
  try {
    await writeFile(file, `${JSON.stringify(self)}\n`, { flag: "wx" });
    return { kind: "take" };
  } catch (err) {
    if (!isExists(err)) throw err;
  }
  const existing = await readHolder(file);
  const decision = decideLock(existing, self, isAlive);
  if (decision.kind === "held" || (isHolder(existing) && existing.pid === self.pid) || attemptsLeft <= 1) return decision;
  await rm(file, { force: true });
  return acquireLock(file, self, isAlive, attemptsLeft - 1);
}
