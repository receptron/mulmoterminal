// Split in-memory (pending) sessions against what disk already holds: a session disk has
// persisted is pruned (its on-disk record, with the real title, wins), everything else is a
// pending sidebar row. Kept pure — the knownSessions delete (a write) and the activity/hidden
// lookups stay injectable so the decision can be tested without the live registry.
import type { Activity, KnownSession, PendingSession } from "./types.js";

export interface PartitionPendingResult {
  keep: PendingSession[]; // pending rows to show, input order preserved
  persisted: string[]; // ids the caller should delete from knownSessions
}

function toPendingRow(id: string, meta: KnownSession, activityOf: (id: string) => Activity | undefined, isHidden: (id: string) => boolean): PendingSession {
  const a = activityOf(id);
  return {
    kind: "pending",
    id,
    title: meta.title,
    mtime: meta.createdAt,
    working: a?.working ?? false,
    waiting: a?.waiting ?? false,
    event: a?.event ?? null,
    hidden: isHidden(id),
  };
}

export function partitionPending(
  known: Iterable<[string, KnownSession]>,
  onDisk: Set<string>,
  activityOf: (id: string) => Activity | undefined,
  isHidden: (id: string) => boolean,
): PartitionPendingResult {
  const keep: PendingSession[] = [];
  const persisted: string[] = [];
  for (const [id, meta] of known) {
    if (onDisk.has(id)) persisted.push(id);
    else keep.push(toPendingRow(id, meta, activityOf, isHidden));
  }
  return { keep, persisted };
}
