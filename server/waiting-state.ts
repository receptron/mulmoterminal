// Pure transforms for the restart-persisted attention state (see WAITING_STATE_FILE in
// index.ts). Split out so the snapshot/restore rules are unit-testable.

export interface WaitingActivity {
  waiting?: boolean;
  event?: string | null;
}

// The set of blocked/done sessions to persist: waiting ones, minus hidden translation
// workers (they can flag waiting internally but must never surface, and their activity
// is deleted on cleanup without a re-persist).
export function buildWaitingSnapshot(entries: Iterable<readonly [string, WaitingActivity]>, isHidden: (id: string) => boolean): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  for (const [id, a] of entries) {
    if (a.waiting && !isHidden(id)) snapshot[id] = a.event ?? null;
  }
  return snapshot;
}

// Parse a persisted snapshot back into id/event pairs, dropping anything that isn't a
// valid session id (a corrupt/tampered file must not smuggle entries into the map).
export function parseWaitingState(raw: unknown, isValidId: (id: string) => boolean): Array<{ id: string; event: string | null }> {
  if (!raw || typeof raw !== "object") return [];
  const out: Array<{ id: string; event: string | null }> = [];
  for (const [id, event] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidId(id)) out.push({ id, event: typeof event === "string" ? event : null });
  }
  return out;
}
