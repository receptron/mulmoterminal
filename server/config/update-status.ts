// The "update available" state for the web-header badge. The server runs the check itself
// (shared computeUpdateNotice) rather than reading a launcher-written file, because under
// `yarn dev` the launcher isn't in the loop — only the server is. The result is cached in
// ~/.mulmoterminal/update-status.json with a timestamp so a dev `--watch` restart storm reuses
// a recent answer instead of firing a git ls-remote (or a registry fetch) every reload.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { computeUpdateNotice, isUpdateCheckDisabled } from "../../bin/update-check.js";
import { MULMOTERMINAL_HOME } from "./env.js";

// This file is server/config/update-status.ts, so two dirs up is the install root — the git
// checkout (dev / a clone) or the package dir under node_modules (npm) the check runs against.
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { version: VERSION } = createRequire(import.meta.url)("../../package.json") as { version: string };

export const UPDATE_STATUS_FILE = path.join(MULMOTERMINAL_HOME, "update-status.json");
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface UpdateStatus {
  notice: string | null;
}

interface CacheEntry {
  notice: string | null;
  at: number;
}

// A cached result is worth reusing only if it carries a real timestamp and hasn't aged out.
// A missing/garbage `at` forces a fresh check rather than trusting an unknown vintage.
export function isCacheFresh(at: unknown, now: number, ttlMs: number = CACHE_TTL_MS): boolean {
  return typeof at === "number" && at > 0 && at <= now && now - at < ttlMs;
}

// The cache entry out of whatever was on disk, or null when it can't be trusted (not an
// object, no timestamp, non-string notice). Never throws — a hand-edited or half-written file
// just means "no usable cache", so the check re-runs.
export function parseCacheEntry(raw: unknown): CacheEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { notice, at } = raw as { notice?: unknown; at?: unknown };
  if (typeof at !== "number") return null;
  return { notice: typeof notice === "string" && notice.length > 0 ? notice : null, at };
}

let cached: UpdateStatus = { notice: null };
export function getUpdateStatus(): UpdateStatus {
  return cached;
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    return parseCacheEntry(JSON.parse(await readFile(UPDATE_STATUS_FILE, "utf8")));
  } catch {
    return null;
  }
}

async function writeCache(notice: string | null, now: number): Promise<void> {
  try {
    await mkdir(MULMOTERMINAL_HOME, { recursive: true });
    await writeFile(UPDATE_STATUS_FILE, JSON.stringify({ notice, at: now }));
  } catch {
    // best-effort — the badge simply won't have a cache next restart
  }
}

// Populate the in-memory status the route serves: honour the opt-out, else reuse a fresh
// cache, else run the check and cache it. Best-effort — any failure leaves the badge hidden.
export async function refreshUpdateStatus(now: number = Date.now()): Promise<void> {
  if (isUpdateCheckDisabled(process.env)) {
    cached = { notice: null };
    return;
  }
  const disk = await readCache();
  if (disk && isCacheFresh(disk.at, now)) {
    cached = { notice: disk.notice };
    return;
  }
  try {
    const notice = await computeUpdateNotice(PKG_DIR, VERSION);
    cached = { notice };
    await writeCache(notice, now);
  } catch {
    // best-effort — keep the last good value
  }
}
