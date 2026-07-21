// Registry of the sessions the scheduler spawned (worklog / config/scheduler/tasks.json).
// Nobody watches these — no ✕ is ever pressed, and a background session blocked on a
// permission prompt never finishes a turn — so the hook-driven reap machinery can miss
// them entirely and their tmux sessions pile up (#541: 76 sessions / 41.8 GB).
//
// The registry is the second line: it bounds the population by count AND age regardless
// of what the session's hooks did. It is persisted (a tiny file, at most `keep` entries)
// so sessions that outlived a server restart — tmux survives it by design — are still
// reaped afterwards.
//
// The file is per WORKSPACE (scheduledSessionsFile). The user runs several clones off one
// ~/.mulmoterminal, and a single shared file would put every instance in contention over
// it; splitting by workspace means each server normally owns its file outright.
//
// "Normally" is not "always" — PORT is configurable, so two servers CAN run against one
// workspace — hence the reconcile at the top of each sweep: we fold in whatever landed on
// disk before deciding what to reap, so ids we never registered are still swept, and a
// write we lose to a peer is re-added on our next sweep. That leaves a window where a
// dropped id is untracked, which turns permanent only if this process dies inside it; a
// lock file's stale-lock failures are likelier than that, and a compacting journal has
// the same race, so the self-healing window is the trade we take.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
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

/** Fold what is on disk into our own records, so a second server on this workspace (two
 *  are possible — PORT is configurable) has its ids swept by us as well, and ids of ours
 *  it overwrote come back. Ids we already reaped are never resurrected, or its stale copy
 *  would keep re-adding them. */
export function mergeScheduledSessions(
  onDisk: readonly ScheduledSessionRecord[],
  ours: readonly ScheduledSessionRecord[],
  reaped: ReadonlySet<string>,
): ScheduledSessionRecord[] {
  const known = new Set(ours.map((record) => record.id));
  return [...ours, ...onDisk.filter((record) => !known.has(record.id) && !reaped.has(record.id))];
}

/** Where this workspace's registry lives. Encoded the way Claude encodes its own project
 *  dirs ("/" and "." → "-"), so the file is recognizable when you go looking for it. */
export function scheduledSessionsFile(workspace: string, home: string = path.join(os.homedir(), ".mulmoterminal")): string {
  return path.join(home, "scheduled-sessions", `${path.resolve(workspace).replace(/[/.]/g, "-")}.json`);
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
  const reaped = new Set<string>();

  const readPersisted = async (): Promise<ScheduledSessionRecord[]> => {
    try {
      return parseScheduledSessions(JSON.parse(await fs.readFile(deps.file, "utf8")), deps.isValidId);
    } catch {
      return []; // no file yet / unreadable => nothing to fold in
    }
  };

  const hydrated: Promise<void> = (async () => {
    records = await readPersisted();
  })();

  const persist = (): Promise<void> => writeFileAtomic(deps.file, JSON.stringify(records));

  // The expired session may be live (kill the pty + its tmux), or a tmux left behind by a
  // previous server run (kill it directly) — the same two-step the ✕ / terminate route uses.
  const evict = (record: ScheduledSessionRecord): void => {
    deps.reapSession(record.id);
    if (deps.hasTmux(record.id)) deps.killTmux(record.id);
    reaped.add(record.id);
  };

  const runSweep = async (): Promise<void> => {
    // Reconcile BEFORE selecting, so retention covers ids we never registered ourselves.
    records = mergeScheduledSessions(await readPersisted(), records, reaped);
    const { keep, expire } = selectExpiredScheduledSessions(records, now(), policy);
    // Never yank a session out from under someone who has it open — the reap machinery
    // leaves attached sessions alone too. It stays registered, so a later sweep retries.
    const isOpen = (record: ScheduledSessionRecord) => deps.isAttached(record.id);
    const held = expire.filter(isOpen);
    const evicted = expire.filter((record) => !isOpen(record));
    evicted.forEach(evict);
    if (evicted.length > 0) console.log(`[scheduler] reaped ${evicted.length} scheduled session(s) past retention`);
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
        await runSweep(); // persists, so the new id survives a restart either way
      });
    },
    sweep: () => enqueue(runSweep),
  };
}
