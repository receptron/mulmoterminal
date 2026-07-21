// Registry of the sessions the scheduler spawned (worklog / config/scheduler/tasks.json).
// Nobody watches these — no ✕ is ever pressed, and a background session blocked on a
// permission prompt never finishes a turn — so the hook-driven reap machinery can miss
// them entirely and their tmux sessions pile up (#541: 76 sessions / 41.8 GB).
//
// The registry is the second line: it bounds the population by count AND age regardless
// of what the session's hooks did. It is persisted so sessions that outlived a server
// restart — tmux survives one by design — are still reaped afterwards.
//
// It is a DIRECTORY of one small file per session, not a list in one file. A list has to
// be rewritten to add an entry, and two servers can share a workspace (PORT is
// configurable), so that read-modify-write could drop an id — and an id nobody has on
// file is an id nobody reaps, which is the leak coming back. One file per session means
// writers never touch each other's entries, so there is no window to lose one in: the
// only shared operations are "create my file" and "unlink an expired one".
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeFileAtomic } from "../files/atomic-write.js";

export interface ScheduledSessionRecord {
  id: string;
  createdAt: number;
}

export interface RetentionPolicy {
  /** How many of the newest scheduled sessions stay alive, so their results are still viewable. */
  keep: number;
  /** Hard age cap: a scheduled session older than this goes, however few there are. */
  ttlMs: number;
}

export const SCHEDULED_SESSION_RETENTION: RetentionPolicy = { keep: 5, ttlMs: 24 * 60 * 60_000 };

/** Split records into the ones to keep alive and the ones to reap: newest `keep` survive,
 *  and anything past `ttlMs` goes regardless of rank. Pure, so the retention rule is
 *  testable without a PTY or a clock. */
export function selectExpiredScheduledSessions(
  records: readonly ScheduledSessionRecord[],
  nowMs: number,
  policy: RetentionPolicy = SCHEDULED_SESSION_RETENTION,
): { keep: ScheduledSessionRecord[]; expire: ScheduledSessionRecord[] } {
  const newestFirst = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const keep: ScheduledSessionRecord[] = [];
  const expire: ScheduledSessionRecord[] = [];
  newestFirst.forEach((record, rank) => {
    const tooOld = nowMs - record.createdAt >= policy.ttlMs;
    if (rank >= policy.keep || tooOld) expire.push(record);
    else keep.push(record);
  });
  return { keep, expire };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Read one session's entry, or null when it is malformed — a corrupt or hand-edited file
 *  must not smuggle a bad id into a `tmux kill-session` argument. */
export function parseScheduledSessionRecord(id: string, raw: unknown, isValidId: (id: string) => boolean): ScheduledSessionRecord | null {
  if (!isValidId(id) || !isRecord(raw)) return null;
  const { createdAt } = raw;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  return { id, createdAt };
}

/** Does a tmux client other than our own hold this session? Each mulmoterminal server
 *  holds exactly ONE tmux client per session it runs, so a count above our own share
 *  belongs to another process — the signal that a PORT-split peer on this workspace would
 *  lose a live session if we killed it. Our own detached background pty counts as ours,
 *  which is what keeps the leak this whole registry exists for reapable. A count tmux
 *  can't give (null) means there is no tmux session to take from anyone: not held. */
export function heldByAnotherProcess(attachedClients: number | null, weHoldAPty: boolean): boolean {
  if (attachedClients === null) return false;
  return attachedClients > (weHoldAPty ? 1 : 0);
}

// A path can't be used as a filename raw: on Windows it carries `\` and `:`, which are a
// separator and a stream marker, so the write would fail (or land somewhere unintended)
// and Windows would silently lose restart-time cleanup. Fold everything unsafe to "-" and
// keep a digest of the real path, since folding alone would let two workspaces collide.
const SLUG_MAX = 60;

/** The directory holding this workspace's scheduled-session entries. Per workspace so a
 *  server only ever reaps sessions from the workspace it owns. */
export function scheduledSessionsDir(workspace: string, home: string = path.join(os.homedir(), ".mulmoterminal")): string {
  const resolved = path.resolve(workspace);
  const slug = resolved
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX);
  const digest = createHash("sha256").update(resolved).digest("hex").slice(0, 8);
  return path.join(home, "scheduled-sessions", `${slug}-${digest}`);
}

export interface ScheduledSessionRegistryDeps {
  dir: string;
  isValidId: (id: string) => boolean;
  /** Would anyone lose this session if we killed it — our own viewer, or another server
   *  process holding it? Must account for BOTH: two servers can share a workspace, and a
   *  process-local check would happily tear down a session live in the other one. */
  isInUse: (id: string) => boolean;
  /** Reap a live session (pty + tmux + cleanup); a no-op once no live entry is left. */
  reapSession: (id: string) => void;
  hasTmux: (id: string) => boolean;
  killTmux: (id: string) => void;
  policy?: RetentionPolicy;
  now?: () => number;
}

export interface ScheduledSessionRegistry {
  /** Record a freshly spawned scheduled session, then sweep. */
  register: (id: string) => void;
  /** Reap every registered session past the retention policy. */
  sweep: () => Promise<void>;
}

export function createScheduledSessionRegistry(deps: ScheduledSessionRegistryDeps): ScheduledSessionRegistry {
  const policy = deps.policy ?? SCHEDULED_SESSION_RETENTION;
  const now = deps.now ?? Date.now;
  const entryFile = (id: string) => path.join(deps.dir, `${id}.json`);

  const readEntry = async (name: string): Promise<ScheduledSessionRecord | null> => {
    if (!name.endsWith(".json")) return null;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(deps.dir, name), "utf8"));
      return parseScheduledSessionRecord(name.slice(0, -".json".length), raw, deps.isValidId);
    } catch {
      return null; // unreadable / not JSON — not something we can act on
    }
  };

  // The directory IS the state: every sweep reads it fresh, so entries another server on
  // this workspace wrote are swept by us too, with nothing to reconcile or lose.
  const readRecords = async (): Promise<ScheduledSessionRecord[]> => {
    const names = await fs.readdir(deps.dir).catch(() => [] as string[]);
    const entries = await Promise.all(names.map(readEntry));
    return entries.filter((entry): entry is ScheduledSessionRecord => entry !== null);
  };

  // The expired session may be live (kill the pty + its tmux), or a tmux left behind by a
  // previous server run (kill it directly) — the same two-step the ✕ / terminate route uses.
  const evict = async (record: ScheduledSessionRecord): Promise<void> => {
    deps.reapSession(record.id);
    if (deps.hasTmux(record.id)) deps.killTmux(record.id);
    await fs.rm(entryFile(record.id), { force: true });
  };

  const runSweep = async (): Promise<void> => {
    const { expire } = selectExpiredScheduledSessions(await readRecords(), now(), policy);
    // Never yank a session out from under someone who has it open — the reap machinery
    // leaves attached sessions alone too. Its entry stays, so a later sweep retries.
    const evicted = expire.filter((record) => !deps.isInUse(record.id));
    await Promise.all(evicted.map(evict));
    if (evicted.length > 0) console.log(`[scheduler] reaped ${evicted.length} scheduled session(s) past retention`);
  };

  // One chain, so a sweep can't run against a half-written registration.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((err) => console.error(`[scheduler] session registry: ${err instanceof Error ? err.message : String(err)}`));
    return queue;
  };

  return {
    register: (id: string) => {
      // The id becomes a filename, so validate BEFORE building the path — reads already
      // drop a bad id, and a caller passing "../…" must not be able to write outside the
      // registry. Today's caller mints a uuid; this keeps that from being load-bearing.
      if (!deps.isValidId(id)) {
        console.warn(`[scheduler] refusing to register a session id that is not canonical: ${JSON.stringify(id)}`);
        return;
      }
      // Stamp the spawn time HERE, not inside the queued task: the write may drain much
      // later, and an age cap measured from the drain would keep a session alive too long.
      const createdAt = now();
      void enqueue(async () => {
        await writeFileAtomic(entryFile(id), JSON.stringify({ createdAt }));
        await runSweep();
      });
    },
    sweep: () => enqueue(runSweep),
  };
}
