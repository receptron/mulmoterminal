// Reading back through another terminal's conversation for a relay (#3389): page by page through
// the same reader the conversation view uses, until the last relayed turn is seen, the budget is
// spent, the first turn is reached, or the page limit stops it.

import type { TranscriptPage } from "../../../common/transcriptView.js";
import {
  completedCount,
  relayFingerprint,
  relayTurnChars,
  relayTurnOf,
  selectRelay,
  type RelayLimits,
  type RelaySelection,
  type RelayTurn,
} from "./relay-range.js";

/** A ceiling on file reads per request, whatever the budget says: a conversation of tiny turns
 *  must not walk an entire long log to reach a marker the budget would never show. */
export const RELAY_MAX_PAGES = 8;

export interface RelayReadDeps {
  readPage: (before: string | null) => Promise<TranscriptPage>;
  lastCompletedPrompt: () => Promise<string | null>;
}

interface Collected {
  turns: RelayTurn[];
  reachedStart: boolean;
}

const pageTurns = (page: TranscriptPage): RelayTurn[] =>
  page.view.status === "ok" ? page.view.turns.map(relayTurnOf).filter((turn): turn is RelayTurn => turn !== null) : [];

interface Walk {
  deps: RelayReadDeps;
  mark: string | null;
  lastPrompt: string | null;
  limits: RelayLimits;
}

// Only COMPLETED turns spend the budget: a huge turn still running is never sent, and letting it
// stop the walk would hide the older finished turns that are.
function enough(turns: readonly RelayTurn[], walk: Walk): boolean {
  const complete = turns.slice(0, completedCount(turns, walk.lastPrompt));
  if (walk.mark !== null && complete.some((turn) => relayFingerprint(turn) === walk.mark)) return true;
  return complete.reduce((n, turn) => n + relayTurnChars(turn, walk.limits), 0) >= walk.limits.totalMaxChars;
}

async function collect(walk: Walk, before: string | null, pagesLeft: number, newer: RelayTurn[]): Promise<Collected> {
  const page = await walk.deps.readPage(before);
  const turns = [...pageTurns(page), ...newer];
  // A page that is not `ok` (too-large) also ends the walk, but the marker may sit in what it could
  // not read — so it is not the start, and a marker not yet seen is not lost.
  if (page.older === null) return { turns, reachedStart: page.view.status === "ok" };
  if (pagesLeft <= 1 || enough(turns, walk)) return { turns, reachedStart: false };
  return collect(walk, page.older, pagesLeft - 1, turns);
}

// The last completed prompt is read FIRST, because the walk needs it to know which turns count.
export async function readRelay(deps: RelayReadDeps, mark: string | null, limits: RelayLimits): Promise<RelaySelection> {
  const lastPrompt = await deps.lastCompletedPrompt();
  const collected = await collect({ deps, mark, lastPrompt, limits }, null, RELAY_MAX_PAGES, []);
  return selectRelay({ turns: collected.turns, completed: completedCount(collected.turns, lastPrompt), mark, reachedStart: collected.reachedStart, limits });
}
