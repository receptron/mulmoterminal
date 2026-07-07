import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ROLLOUT_RE = /^rollout-.*\.jsonl$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCOVERY_TIMEOUT_MS = 5000;
const DISCOVERY_INTERVAL_MS = 150;

export interface CodexSessionMeta {
  id: string;
  cwd: string | null;
}

// codex writes rollout transcripts under $CODEX_HOME/sessions/YYYY/MM/DD/. CODEX_HOME mirrors
// codex's own env, so a container/config relocation is honored (see the Docker plan).
export function codexSessionsRoot(): string {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "sessions");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// The first line of every rollout is a `session_meta` record carrying the id codex minted for
// itself (mulmoterminal can't force one) and the cwd it resolved.
export function parseSessionMetaLine(line: string): CodexSessionMeta | null {
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(doc) || doc.type !== "session_meta" || !isRecord(doc.payload)) return null;
  const { id, cwd } = doc.payload;
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  return { id, cwd: typeof cwd === "string" ? cwd : null };
}

export function readSessionMeta(rolloutFile: string): CodexSessionMeta | null {
  try {
    const content = readFileSync(rolloutFile, "utf8");
    const newline = content.indexOf("\n");
    return parseSessionMetaLine(newline === -1 ? content : content.slice(0, newline));
  } catch {
    return null;
  }
}

function dayDir(root: string, when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return path.join(root, String(when.getFullYear()), month, day);
}

// Only today + yesterday can hold a session spawned "now" (covers a spawn racing midnight),
// so discovery never walks the whole history.
function recentDayDirs(root: string, now: Date): string[] {
  return [dayDir(root, now), dayDir(root, new Date(now.getTime() - ONE_DAY_MS))];
}

function listRolloutsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => ROLLOUT_RE.test(name))
    .map((name) => path.join(dir, name));
}

export function listRecentRollouts(root: string, now: Date = new Date()): string[] {
  return recentDayDirs(root, now).flatMap(listRolloutsIn);
}

// The rollout files that exist BEFORE spawning codex; the one that appears after is
// unambiguously this session's — no reliance on clock/mtime alignment.
export function snapshotSessions(root: string, now: Date = new Date()): Set<string> {
  return new Set(listRecentRollouts(root, now));
}

function mtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

export function findNewRollout(root: string, before: Set<string>, now: Date = new Date()): string | null {
  const fresh = listRecentRollouts(root, now).filter((file) => !before.has(file));
  if (fresh.length === 0) return null;
  return fresh.reduce((newest, file) => (mtimeMs(file) > mtimeMs(newest) ? file : newest));
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Poll for the rollout codex creates at startup, then read its minted id. Keeps polling past a
// half-written first line (the file can appear before its JSON is flushed). Null on timeout —
// e.g. codex failed to launch.
export async function discoverCodexSession(
  root: string,
  before: Set<string>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<(CodexSessionMeta & { file: string }) | null> {
  const timeoutMs = opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DISCOVERY_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const attempt = (): (CodexSessionMeta & { file: string }) | null => {
    const file = findNewRollout(root, before);
    const meta = file ? readSessionMeta(file) : null;
    return meta && file ? { ...meta, file } : null;
  };
  let result = attempt();
  while (!result && Date.now() < deadline) {
    await delay(intervalMs);
    result = attempt();
  }
  return result;
}
