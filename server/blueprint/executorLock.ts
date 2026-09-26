// Only one MulmoTerminal on a machine drives blueprint runs. Every instance reads the same run records
// under ~/.mulmoterminal, so two executors would each start sessions for one step and overwrite each
// other's saves — two agents in one folder. The first server to take this lock drives the runs; the
// others still show them, and hand the lock over only once its holder has died.
import { readFile, rm, writeFile } from "node:fs/promises";
import { isRecord } from "../../common/isRecord.js";

export interface LockHolder {
  pid: number;
  port: string;
  /** Random per server start: "is this lock mine" must not rest on a pid the system can reuse. */
  token: string;
}

export type LockDecision = { kind: "take" } | { kind: "held"; holder: LockHolder };

const isHolder = (value: unknown): value is LockHolder =>
  isRecord(value) &&
  typeof value.pid === "number" &&
  Number.isInteger(value.pid) &&
  value.pid > 0 &&
  typeof value.port === "string" &&
  typeof value.token === "string" &&
  value.token.length > 0;

/** Pure: whether `self` may drive the runs, given what the lock file holds (as parsed, or null). */
export function decideLock(existing: unknown, self: LockHolder, isAlive: (pid: number) => boolean): LockDecision {
  if (!isHolder(existing) || existing.token === self.token || !isAlive(existing.pid)) return { kind: "take" };
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

// Enough to replace a stale lock even when another server is replacing it at the same moment.
const LOCK_ATTEMPTS = 3;

const isExists = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "EEXIST";

/** Whether the lock file names this server now — another server may have taken it over. */
export async function holdsLock(file: string, self: LockHolder): Promise<boolean> {
  const existing = await readHolder(file);
  return isHolder(existing) && existing.token === self.token;
}

const createLock = async (file: string, self: LockHolder): Promise<boolean> => {
  try {
    await writeFile(file, `${JSON.stringify(self)}\n`, { flag: "wx" });
    return true;
  } catch (err) {
    if (isExists(err)) return false;
    throw err;
  }
};

// What the file says once this server has written it: two servers replacing the same stale lock can
// race, so the write is read back rather than trusted.
export async function confirmLock(file: string, self: LockHolder): Promise<LockDecision> {
  const holder = await readHolder(file);
  if (isHolder(holder) && holder.token === self.token) return { kind: "take" };
  if (isHolder(holder)) return { kind: "held", holder };
  throw new Error(`could not take the blueprint lock at ${file}`);
}

// Created with `wx`, so of two servers starting together exactly one creates it. A stale or
// malformed lock is removed and the creation tried again. An owner also re-reads it (holdsLock)
// before every change, so a lost race is noticed rather than acted on.
export async function acquireLock(
  file: string,
  self: LockHolder,
  isAlive: (pid: number) => boolean = processIsAlive,
  attemptsLeft = LOCK_ATTEMPTS,
): Promise<LockDecision> {
  if (await createLock(file, self)) return confirmLock(file, self);
  const existing = await readHolder(file);
  const decision = decideLock(existing, self, isAlive);
  if (decision.kind === "held" || (isHolder(existing) && existing.token === self.token)) return decision;
  if (attemptsLeft <= 1) throw new Error(`could not take the blueprint lock at ${file}`);
  await rm(file, { force: true });
  return acquireLock(file, self, isAlive, attemptsLeft - 1);
}
