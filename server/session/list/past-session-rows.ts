// The phone's list of one directory's past sessions (#2999): every hosted agent's own listing,
// merged into one newest-first list. Pure so the merge, the cap and the "is this id in the list"
// question the transcript read rests on can be pinned without a disk.
import type { TerminalAgent } from "../../../common/sessionAgent.js";

/** One row as an agent's own lister answers it. */
export interface AgentSessionRow {
  id: string;
  title: string;
  mtime: number;
  account?: string | null;
}

export interface AgentSessionRows {
  agent: TerminalAgent;
  rows: readonly AgentSessionRow[];
}

/** What the phone gets. `readable` says whether a transcript reader here answers for `agent` —
 *  the list shows every agent's rows, and only the reader-less ones are marked. */
export interface PastSessionRow {
  id: string;
  title: string;
  mtime: number;
  agent: TerminalAgent;
  readable: boolean;
  account?: string;
}

const toPastRow = (agent: TerminalAgent, readable: boolean, row: AgentSessionRow): PastSessionRow => {
  const base = { id: row.id, title: row.title || row.id, mtime: Number.isFinite(row.mtime) ? row.mtime : 0, agent, readable };
  // Omitted rather than set to undefined: Firestore rejects a document holding an undefined field,
  // and the phone would only see its command time out.
  return row.account ? { ...base, account: row.account } : base;
};

export function mergePastSessionRows(perAgent: readonly AgentSessionRows[], isReadable: (agent: TerminalAgent) => boolean, limit: number): PastSessionRow[] {
  return perAgent
    .flatMap(({ agent, rows }) => rows.filter((row) => typeof row.id === "string" && row.id !== "").map((row) => toPastRow(agent, isReadable(agent), row)))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, Math.max(0, limit));
}

/** The listed row for `id`, or null. The transcript read is allowed only for a row this returns. */
export const findPastSession = (rows: readonly PastSessionRow[], id: string): PastSessionRow | null => rows.find((row) => row.id === id) ?? null;
