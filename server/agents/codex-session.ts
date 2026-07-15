import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ROLLOUT_RE = /^rollout-.*\.jsonl$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WATCH_POLL_MS = 1000;
const WATCH_MAX_WAIT_MS = 30 * 60 * 1000;

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
// so watching never walks the whole history.
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

// The rollout files that exist BEFORE spawning codex; a file that appears after is this
// session's (codex only persists its rollout after the first user turn, so this can be minutes).
export function snapshotSessions(root: string, now: Date = new Date()): Set<string> {
  return new Set(listRecentRollouts(root, now));
}

interface RolloutMeta extends CodexSessionMeta {
  file: string;
}

// A rollout that appeared since the snapshot, attributed to this session ONLY when unambiguous:
// exactly one appeared, or exactly one of several matches this session's cwd. Otherwise refuse to
// guess (return null) — a wrong guess would let a cold resume reopen a *different* concurrent
// codex conversation. A "newest wins" tiebreak would be exactly that wrong guess, so there isn't
// one; a session that can't be attributed just stays unresumable-by-id (cold reconnect starts fresh).
// `claimed` holds rollouts already mapped to another session, so a single rollout is never
// attributed to two keys (which would resume one conversation from both).
export function pickFreshSession(root: string, before: Set<string>, cwd: string | null, claimed?: Set<string>): RolloutMeta | null {
  const found = listRecentRollouts(root)
    .filter((file) => !before.has(file) && !claimed?.has(file))
    .map((file) => ({ file, meta: readSessionMeta(file) }))
    .filter((x): x is { file: string; meta: CodexSessionMeta } => x.meta !== null);
  if (found.length === 1) return { ...found[0].meta, file: found[0].file };
  const matches = cwd ? found.filter((x) => x.meta.cwd === cwd) : [];
  if (matches.length === 1) return { ...matches[0].meta, file: matches[0].file };
  return null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// codex persists a session's rollout only AFTER its first user turn (like claude's transcript),
// so we watch for the whole session — not just at spawn — until the rollout appears, then read
// its minted id. Stops early when the session is gone (isCancelled) so it can't outlive the pty.
export async function watchForCodexSession(
  root: string,
  before: Set<string>,
  opts: { cwd?: string | null; pollMs?: number; maxWaitMs?: number; isCancelled?: () => boolean; claimed?: Set<string> } = {},
): Promise<RolloutMeta | null> {
  const pollMs = opts.pollMs ?? WATCH_POLL_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? WATCH_MAX_WAIT_MS);
  const isCancelled = opts.isCancelled ?? (() => false);
  const cwd = opts.cwd ?? null;
  let result = pickFreshSession(root, before, cwd, opts.claimed);
  while (!result && Date.now() < deadline && !isCancelled()) {
    await delay(pollMs);
    result = pickFreshSession(root, before, cwd, opts.claimed);
  }
  return result;
}
