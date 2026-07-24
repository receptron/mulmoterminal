// The rules behind the two list endpoints, separated from the routes that serve them so
// they can be tested without an app: which sessions the sidebar shows, in what order, and
// which ids an activity poll is allowed to ask about.
//
// Worth isolating because the rules are quiet — a row that should have been hidden still
// looks like a plausible response, so a regression here reads as correct output.
import type { DiskStat, PendingSession } from "./types.js";

export type SessionRow = DiskStat | PendingSession;

export interface SessionRowFilter {
  /** Transient internal helpers, never user-visible chats. */
  isTranslationWorker: (id: string) => boolean;
  /** Multi-terminal GRID sessions. */
  isDevTerminal: (id: string) => boolean;
  /** True for the unscoped (chat sidebar) query, false for a cwd-scoped one. */
  includePending: boolean;
  limit: number;
}

/** The rows a listing should render: newest first, capped, with the hidden kinds dropped.
 *  The dev-terminal exclusion applies ONLY to the unscoped chat query — the grid's own
 *  resume picker passes ?cwd= and must keep listing its sessions, or they stop being
 *  resumable. Pure so that rule can be pinned; it is one boolean away from silently
 *  hiding the grid's own sessions from itself. */
export function selectSessionRows(rows: readonly SessionRow[], filter: SessionRowFilter): SessionRow[] {
  return rows
    .filter((row) => !filter.isTranslationWorker(row.id))
    .filter((row) => !filter.includePending || !filter.isDevTerminal(row.id))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, filter.limit);
}

/** The session ids an /api/activity poll may ask about: well-formed ones only, capped so a
 *  client can't make us parse an unbounded query string. A non-string query yields none. */
export function parseActivityIds(raw: unknown, isValidId: (id: string) => boolean, limit: number): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .filter((id) => isValidId(id))
    .slice(0, limit);
}
