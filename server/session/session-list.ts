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
  /** True for the unscoped (chat sidebar) query, false for a cwd-scoped one. Also picks the
   *  dev-terminal direction: unscoped hides grid sessions, cwd-scoped shows ONLY them (#724). */
  includePending: boolean;
  limit: number;
}

/** The rows a listing should render: newest first, capped, with the hidden kinds dropped.
 *  Two mirror-image rules on the same dev-terminal set: the unscoped CHAT sidebar hides grid
 *  sessions (they're the grid's, not chats), while the grid's OWN cwd-scoped resume picker shows
 *  ONLY grid sessions — a plain `claude`/mulmoclaude transcript in the dir isn't a grid terminal
 *  and shouldn't be offered to resume there (#724). The grid's own sessions must stay listed in
 *  the cwd-scoped view, or they stop being resumable. Pure so both rules can be pinned. */
export function selectSessionRows(rows: readonly SessionRow[], filter: SessionRowFilter): SessionRow[] {
  return rows
    .filter((row) => !filter.isTranslationWorker(row.id))
    .filter((row) => (filter.includePending ? !filter.isDevTerminal(row.id) : filter.isDevTerminal(row.id)))
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
