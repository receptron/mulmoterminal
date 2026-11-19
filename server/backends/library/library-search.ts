// Search over the Library's index (#3328): one hit per conversation, from its turns or its title,
// newest conversation first. A conversation found by both shows the turn, which says more.
import type { DatabaseSync } from "node:sqlite";
import type { LibrarySearchHit, LibraryTurnRole } from "../../../common/library.js";
import { LIBRARY_TURN_ROLES } from "../../../common/library.js";
import { readString } from "../../../common/readString.js";
import { conversationOfRow, matchingTurns, searchTitles, searchTurns, type ConversationFilter, type SearchPattern } from "./index-queries.js";
import { escapeLike, snippetAround } from "./library-text.js";

/** The trigram index answers a query of at least this many characters; a shorter one is scanned. */
export const TRIGRAM_CHARS = 3;
export const MAX_QUERY_CHARS = 200;

const roleOf = (value: unknown): LibraryTurnRole | null => LIBRARY_TURN_ROLES.find((role) => role === value) ?? null;

/** An FTS5 phrase: quoted, with any quote doubled, so nothing the user types is read as syntax. */
export const ftsPhrase = (query: string): string => `"${query.replace(/"/g, '""')}"`;

export function searchLibrary(db: DatabaseSync, rawQuery: string, filter: ConversationFilter, limit: number): LibrarySearchHit[] {
  const query = rawQuery.trim();
  if (query === "") return [];
  const pattern: SearchPattern = { match: [...query].length >= TRIGRAM_CHARS ? ftsPhrase(query) : null, like: `%${escapeLike(query)}%` };
  const byTurn = searchTurns(db, pattern, filter, limit).map(conversationOfRow);
  const turnIds = new Set(byTurn.map((conversation) => conversation.id));
  const byTitle = searchTitles(db, pattern, filter, limit)
    .map(conversationOfRow)
    .filter((conversation) => !turnIds.has(conversation.id));
  const snippets = firstMatchingTurns(db, pattern, [...turnIds], query);
  return [...byTurn, ...byTitle]
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, limit)
    .map((conversation) => ({ conversation, snippet: snippets.get(conversation.id)?.snippet ?? null, role: snippets.get(conversation.id)?.role ?? null }));
}

function firstMatchingTurns(
  db: DatabaseSync,
  pattern: SearchPattern,
  ids: string[],
  query: string,
): Map<string, { snippet: string; role: LibraryTurnRole | null }> {
  const found = new Map<string, { snippet: string; role: LibraryTurnRole | null }>();
  matchingTurns(db, pattern, ids).forEach((row) => {
    const conv = readString(row.conv);
    if (!found.has(conv)) found.set(conv, { snippet: snippetAround(readString(row.text), query), role: roleOf(row.role) });
  });
  return found;
}
