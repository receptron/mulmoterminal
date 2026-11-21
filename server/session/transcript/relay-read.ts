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

function enough(turns: readonly RelayTurn[], mark: string | null, limits: RelayLimits): boolean {
  if (mark !== null && turns.some((turn) => relayFingerprint(turn) === mark)) return true;
  return turns.reduce((n, turn) => n + relayTurnChars(turn, limits), 0) >= limits.totalMaxChars;
}

async function collect(
  deps: RelayReadDeps,
  mark: string | null,
  limits: RelayLimits,
  before: string | null,
  pagesLeft: number,
  newer: RelayTurn[],
): Promise<Collected> {
  const page = await deps.readPage(before);
  const turns = [...pageTurns(page), ...newer];
  // A page that is not `ok` (too-large) also ends the walk, but the marker may sit in what it could
  // not read — so it is not the start, and a marker not yet seen is not lost.
  if (page.older === null) return { turns, reachedStart: page.view.status === "ok" };
  if (pagesLeft <= 1 || enough(turns, mark, limits)) return { turns, reachedStart: false };
  return collect(deps, mark, limits, page.older, pagesLeft - 1, turns);
}

export async function readRelay(deps: RelayReadDeps, mark: string | null, limits: RelayLimits): Promise<RelaySelection> {
  const [collected, lastPrompt] = await Promise.all([collect(deps, mark, limits, null, RELAY_MAX_PAGES, []), deps.lastCompletedPrompt()]);
  return selectRelay({ turns: collected.turns, completed: completedCount(collected.turns, lastPrompt), mark, reachedStart: collected.reachedStart, limits });
}
