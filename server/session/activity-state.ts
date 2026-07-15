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
