// Which collection each session was started from, as it is read from and written back to disk.
//
// It has to OUTLIVE the process for the same reason the memo log next door does: the cell is still
// on the grid after a restart, and the question it answers — "what was this one opened for?" — has
// not changed. It also has to outlive the BROWSER that asked for the spawn, which is why the
// filing the collection pane keeps in localStorage is not this: that one is per browser, and a
// phone looking at the same grid would see nine identical cells.
//
// An APPEND LOG, for the reason its neighbours spell out: ~/.mulmoterminal is one directory for
// every server on the machine, and launching twice is the ordinary way to get two instances. A
// rewritten snapshot has to be read, merged and written back, and two instances doing that at once
// lose whichever finishes first. Appending needs no read.
//
// Its OWN file rather than a widened existing log: these files are shared between BUILDS as well as
// instances, and widening a line format makes an older build's parser drop every line of a log it
// relies on. A file it has never heard of is simply ignored.
//
// WRITING is safe between instances; READING is not live between them, and the difference is worth
// stating because the paragraph above invites the other reading. A process folds this file once at
// startup and answers from memory afterwards, so a chat spawned by a SECOND live server is unmarked
// in the first until that one restarts. That is deliberate: the read sits on `/api/session/:id`,
// which the cockpit roster polls every four seconds PER CELL, and a re-read there would cost every
// cell of every grid a whole-file fold forever to correct a glyph in a two-server setup. The one
// log here that does refresh (`refreshAgentConversations`) is folded by an OCCUPANCY CHECK — once,
// deliberately, to decide whether a worktree is free — not by a render. `sessionMemos` is read on
// this same route with the same one-shot hydration, for a sentence the user typed; if that gap is
// accepted there it is accepted here, where the worst case is a missing decoration that comes back
// on the next restart.
import type { SessionCollection } from "../../common/sessionCollection.js";

export interface SessionCollectionRecord extends SessionCollection {
  id: string;
}

/** One line of the log. */
export function sessionCollectionLine(record: SessionCollectionRecord): string {
  return `${JSON.stringify(record)}\n`;
}

/**
 * The record a parsed line holds, or null for anything unusable — this id becomes a map key and the
 * icon and title go on screen.
 *
 * The slug is checked against the same rule the collection engine accepts, so a hand-edited line
 * cannot name a path. Nothing here is trusted as one: the slug is only ever compared and displayed.
 */
export function sessionCollectionRecord(
  parsed: Record<string, unknown>,
  isValidSessionId: (id: string) => boolean,
  isValidSlug: (slug: string) => boolean,
): SessionCollectionRecord | null {
  const { id, slug, icon, title } = parsed;
  if (typeof id !== "string" || !isValidSessionId(id)) return null;
  if (typeof slug !== "string" || !isValidSlug(slug)) return null;
  if (typeof icon !== "string" || typeof title !== "string") return null;
  return { id, slug, icon, title };
}

/**
 * Fold one record into the map: the newest line for a session wins.
 *
 * There is no ERASE — a session is started from one collection once, and the mapping is a fact
 * about how it began rather than a setting. A second line for an id is therefore only ever a
 * correction (a re-record by a later build), and reading in file order leaves it standing.
 */
export function applySessionCollection(collections: Map<string, SessionCollection>, record: SessionCollectionRecord): void {
  const { id, ...collection } = record;
  collections.set(id, collection);
}
