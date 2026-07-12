// Pure parse of a "sessions" pub/sub payload into an attention-state update, so the
// grid can track a cell's blocked/done even while the cell is OFF-PAGE (unmounted).
// The payload carries dev-terminal (grid) activity that the /api/sessions list drops,
// and isn't capped by the list limit. Kept pure + separate for unit testing.

export interface CellActivity {
  working: boolean;
  waiting: boolean;
  event: string | null;
}

export type SessionActivityUpdate = { id: string; closed: true } | { id: string; activity: CellActivity };

export function parseSessionActivityPayload(data: unknown): SessionActivityUpdate | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "string") return null;
  // A "closed" push means the session's PTY was reaped — drop it (no attention).
  if (d.event === "closed") return { id: d.id, closed: true };
  return {
    id: d.id,
    activity: {
      working: !!d.working,
      waiting: !!d.waiting,
      event: typeof d.event === "string" ? d.event : null,
    },
  };
}
