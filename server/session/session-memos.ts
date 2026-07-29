// The memos a user has written on their sessions, as they are read from and written back to disk.
//
// An APPEND LOG, for the reason the id log next door spells out: ~/.mulmoterminal is one directory
// for every server on the machine, and launching twice is the ordinary way to get two instances
// (the launcher falls back to another port when the default is busy). A rewritten snapshot has to
// be read, merged and written back, and two instances doing that at once lose whichever finishes
// first. Appending needs no read.
//
// Unlike that log, a memo is EDITED and ERASED, so ordering is what decides the answer: the last
// line for an id wins, and a line with an empty text is the erase. One JSON object per line rather
// than the id-log's bare `<id> <value>` — a memo is free text, and a user pasting a branch name or
// a quote must not be able to shape the file.

import { normalizeMemo } from "../../common/sessionMemo.js";

export interface SessionMemoRecord {
  id: string;
  text: string;
}

/** One line of the log. `at` is written for a human reading the file; nothing parses it back. */
export function sessionMemoLine(id: string, text: string, at: number): string {
  return `${JSON.stringify({ id, text, at })}\n`;
}

/** The record a parsed line holds, or null for anything unusable — these ids become map keys and
 *  the text goes on screen. */
export function sessionMemoRecord(parsed: Record<string, unknown>, isValidId: (id: string) => boolean): SessionMemoRecord | null {
  const { id, text } = parsed;
  if (typeof id !== "string" || !isValidId(id)) return null;
  if (typeof text !== "string") return null;
  // Normalized on the way IN as well as on the way out: a line hand-edited into the file, or
  // written by a build whose cap was longer, must not put a two-line memo in a one-line header.
  return { id, text: normalizeMemo(text) };
}

/**
 * Fold one record into a memo map: the newest line for an id wins, and an empty text erases it.
 *
 * Folding one at a time rather than parsing a whole file is what lets the reader stream — the file
 * has no cap, since it grows for as long as the user keeps editing memos.
 */
export function applySessionMemo(memos: Map<string, string>, record: SessionMemoRecord): void {
  if (record.text === "") memos.delete(record.id);
  else memos.set(record.id, record.text);
}

/**
 * Which write for a session is the CURRENT one, so a failed write only rolls the in-memory memo
 * back when nothing has replaced it meanwhile.
 *
 * Recency, not value equality (Codex). Two overlapping writes can carry the SAME text — a user
 * hitting save twice, two tabs saving the same note — and then "the map still holds what I put
 * there" is true for a write that has already been superseded. Rolling back on that leaves this
 * process serving the OLD note while the disk holds the new one, until a restart.
 */
export function createMemoWriteGuard() {
  const latest = new Map<string, number>();
  let issued = 0;
  return {
    /** Claim this write as the current one for `id`. */
    begin(id: string): number {
      issued += 1;
      latest.set(id, issued);
      return issued;
    },
    /** Is this write still the one that gets to decide what is in memory? */
    isLatest(id: string, ticket: number): boolean {
      return latest.get(id) === ticket;
    },
  };
}
