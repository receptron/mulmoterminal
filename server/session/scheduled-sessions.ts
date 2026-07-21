// Registry of the sessions the scheduler spawned (worklog / config/scheduler/tasks.json).
// Nobody watches these — no ✕ is ever pressed, and a background session blocked on a
// permission prompt never finishes a turn — so the hook-driven reap machinery can miss
// them entirely and their tmux sessions pile up (#541: 76 sessions / 41.8 GB).
//
// The registry is the second line: it bounds the population by count AND age regardless
// of what the session's hooks did. It is persisted (a tiny file, at most `keep` entries)
// so sessions that outlived a server restart — tmux survives it by design — are still
// reaped afterwards.
import { promises as fs } from "node:fs";
import path from "node:path";

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

/** Parse the persisted array, dropping anything malformed — a corrupt or hand-edited file
 *  must not smuggle a bad id into a `tmux kill-session` argument. */
export function parseScheduledSessions(raw: unknown, isValidId: (id: string) => boolean): ScheduledSessionRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: ScheduledSessionRecord[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { id, createdAt } = entry;
    if (typeof id !== "string" || !isValidId(id)) continue;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) continue;
    records.push({ id, createdAt });
  }
  return records;
}

export interface ScheduledSessionRegistryDeps {
  file: string;
  isValidId: (id: string) => boolean;
  /** Is someone looking at this session right now (a client socket is attached)? */
  isAttached: (id: string) => boolean;
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
  let records: ScheduledSessionRecord[] = [];

  const hydrated: Promise<void> = (async () => {
    try {
      records = parseScheduledSessions(JSON.parse(await fs.readFile(deps.file, "utf8")), deps.isValidId);
    } catch {
      // no file yet / unreadable => start empty
    }
  })();

  const persist = async (): Promise<void> => {
    await fs.mkdir(path.dirname(deps.file), { recursive: true });
    await fs.writeFile(deps.file, JSON.stringify(records));
  };

  // The expired session may be live (kill the pty + its tmux), or a tmux left behind by a
  // previous server run (kill it directly) — the same two-step the ✕ / terminate route uses.
  const evict = (record: ScheduledSessionRecord): void => {
    deps.reapSession(record.id);
    if (deps.hasTmux(record.id)) deps.killTmux(record.id);
  };

  const runSweep = async (): Promise<void> => {
    const { keep, expire } = selectExpiredScheduledSessions(records, now(), policy);
    // Never yank a session out from under someone who has it open — the reap machinery
    // leaves attached sessions alone too. It stays registered, so a later sweep retries.
    const isOpen = (record: ScheduledSessionRecord) => deps.isAttached(record.id);
    const held = expire.filter(isOpen);
    const evicted = expire.filter((record) => !isOpen(record));
    if (evicted.length === 0) return;
    evicted.forEach(evict);
    console.log(`[scheduler] reaped ${evicted.length} scheduled session(s) past retention`);
    records = [...keep, ...held];
    await persist();
  };

  // One chain, so a register() that lands mid-sweep can't write a stale record set.
  let queue: Promise<void> = hydrated;
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((err) => console.error(`[scheduler] session registry: ${err instanceof Error ? err.message : String(err)}`));
    return queue;
  };

  return {
    register: (id: string) => {
      // Stamp the spawn time HERE, not inside the queued task: the write may drain much
      // later, and an age cap measured from the drain would keep a session alive too long.
      const record = { id, createdAt: now() };
      void enqueue(async () => {
        records = [...records, record];
        await persist();
        await runSweep();
      });
    },
    sweep: () => enqueue(runSweep),
  };
}
