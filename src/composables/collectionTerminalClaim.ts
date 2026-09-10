import { ref, type Ref } from "vue";

// What the grid and the collection pane tell each other (#2001).
//
// Two halves of one relationship, in one file because they are only ever read together: the pane
// says which session it wants and where to put it, and the grid says which sessions it has a cell
// for. Neither side imports the other's component.
//
// The chat is an ordinary grid cell — placed at spawn, counted in the grid, closable there. While
// the Collections overlay is open, that cell's `TerminalCell` is TELEPORTED into the pane rather
// than duplicated: one component, one socket, one xterm, one scrollback, moved by the same
// mechanism the zoomed cell already uses (`docs/grid-view-modes.md`). So the same session is
// operated from whichever view is on screen, with no hand-off and no reconnect.
//
// A claim, not a registry: the pane shows one terminal at a time (its other tabs stay in the grid,
// running). Keyed by session rather than by cell uid because uids are positional — they are
// renumbered whenever the grid is re-parsed, and the pane must not hold a number that moves.

export interface CollectionTerminalClaim {
  sessionId: string;
  el: HTMLElement;
}

const claim: Ref<CollectionTerminalClaim | null> = ref(null);

/** Where the grid should put this session's cell. Read by TerminalGrid (the teleport target) and
 *  by GridView (which must render a claimed cell even when its page is not the one on screen). */
export const collectionTerminalClaim = claim;

/** Show `sessionId`'s cell inside `el`. Replaces any previous claim: one terminal is on screen in
 *  the pane at a time, and the tab strip is what switches between them. */
export function claimCollectionTerminal(sessionId: string, el: HTMLElement): void {
  claim.value = { sessionId, el };
}

/** Give the cell back to the grid. Ignores a stale release — the pane can be replaced by a newer
 *  one before the old component's teardown runs, and that must not strand the new claim. */
export function releaseCollectionTerminal(sessionId: string): void {
  if (claim.value?.sessionId === sessionId) claim.value = null;
}

// ---- the grid's half -------------------------------------------------------------------------
//
// The pane owns no terminal: it borrows a cell's, by having the grid teleport it. So a filed chat
// with no cell has nothing to show, and its tab would sit over an empty pane — which is what a
// filing restored across a reload produces when that cell has since been closed.
//
// Null until the grid has said, which is NOT the same as "no cells": absence is only evidence once
// there is an answer to read.
const held: Ref<readonly string[] | null> = ref(null);

export const gridSessionIds = held;

export function publishGridSessions(ids: readonly string[]): void {
  held.value = ids;
}
