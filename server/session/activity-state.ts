// Pure transforms for the restart-persisted attention state (see ACTIVITY_STATE_FILE in
// index.ts). Split out so the snapshot/restore rules are unit-testable. BOTH `working` and
// `waiting` (blocked/done) are persisted so a server restart (e.g. a --watch hot reload)
// doesn't drop a live session to idle. A restored `working` self-corrects: the session's
// next Stop hook clears it (the only stale case is a turn that finished during the restart
// window, whose Stop was lost — corrected on the user's next turn).

export interface RestartActivity {
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
}

export interface PersistedActivity {
  working: boolean;
  waiting: boolean;
  event: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// The sessions to persist across a restart: those that are working OR waiting (blocked/done),
// minus hidden translation workers (they flag waiting internally but must never surface, and
// their activity is deleted on cleanup without a re-persist).
export function buildActivitySnapshot(
  entries: Iterable<readonly [string, RestartActivity]>,
  isHidden: (id: string) => boolean,
): Record<string, PersistedActivity> {
  const snapshot: Record<string, PersistedActivity> = {};
  for (const [id, a] of entries) {
    if ((a.working || a.waiting) && !isHidden(id)) snapshot[id] = { working: !!a.working, waiting: !!a.waiting, event: a.event ?? null };
  }
  return snapshot;
}

// Merge this instance's snapshot of the sessions IT owns onto whatever is currently on disk,
// leaving entries owned by another instance untouched. The file is shared by every server
// rooted at the same MULMOTERMINAL_HOME, so writing a full in-memory snapshot would drop the
// other instance's sessions (they're not in this map) and revive ones it already cleared.
// Owned ids present in `owned` are written; owned ids absent from it (gone idle / reaped) are
// removed; every foreign id on disk is preserved as-is.
export function mergeOwnedActivity(
  onDisk: Record<string, PersistedActivity>,
  owned: Record<string, PersistedActivity>,
  isOwned: (id: string) => boolean,
): Record<string, PersistedActivity> {
  const merged: Record<string, PersistedActivity> = {};
  for (const [id, a] of Object.entries(onDisk)) if (!isOwned(id)) merged[id] = a;
  for (const [id, a] of Object.entries(owned)) merged[id] = a;
  return merged;
}

// Parse a persisted snapshot back into activity records, dropping anything that isn't a valid
// session id / well-formed entry (a corrupt/tampered file must not smuggle entries into the map).
export function parseActivityState(raw: unknown, isValidId: (id: string) => boolean): Array<{ id: string } & PersistedActivity> {
  if (!isRecord(raw)) return [];
  const out: Array<{ id: string } & PersistedActivity> = [];
  for (const [id, v] of Object.entries(raw)) {
    if (!isValidId(id) || !isRecord(v)) continue;
    out.push({ id, working: v.working === true, waiting: v.waiting === true, event: typeof v.event === "string" ? v.event : null });
  }
  return out;
}
