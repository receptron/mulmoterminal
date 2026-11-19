// Reading the Library's index (#3328): the list, one conversation, and search. The tables are
// index-store.ts's; this file only selects from them, and reads every column back through a guard.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { TERMINAL_AGENTS, type TerminalAgent } from "../../../common/sessionAgent.js";
import { AUTOMATED_ENTRYPOINT, type LibraryConversation } from "../../../common/library.js";
import { nullableNumber } from "./index-store.js";

export interface ConversationFilter {
  cwd?: string;
  includeTemporary?: boolean;
  /** `claude -p` and SDK runs (`AUTOMATED_ENTRYPOINT`), left out unless asked for. */
  includeAutomated?: boolean;
  includeSidechains?: boolean;
}

function filterClause(filter: ConversationFilter): { sql: string; params: SQLInputValue[] } {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.cwd !== undefined) {
    parts.push("c.cwd = ?");
    params.push(filter.cwd);
  }
  if (filter.includeTemporary !== true) parts.push("c.is_temporary = 0");
  if (filter.includeAutomated !== true) {
    parts.push("(c.entrypoint is null or c.entrypoint != ?)");
    params.push(AUTOMATED_ENTRYPOINT);
  }
  if (filter.includeSidechains !== true) parts.push("c.is_sidechain = 0");
  return { sql: parts.length ? parts.join(" and ") : "1 = 1", params };
}

export function listConversations(db: DatabaseSync, filter: ConversationFilter, offset: number, limit: number): Record<string, unknown>[] {
  const where = filterClause(filter);
  return db
    .prepare(`select c.* from conversations c where ${where.sql} order by c.ended_at desc nulls last, c.path limit ? offset ?`)
    .all(...where.params, limit, offset);
}

/** The conversations that linked a pull request in `repository` (`owner/repo`, any case), the earliest
 *  begun first — the one that opened a PR started before those that came back to it. */
export function conversationsForRepository(db: DatabaseSync, repository: string, limit: number): Record<string, unknown>[] {
  const where = filterClause({});
  const linked = "exists (select 1 from json_each(c.prs) j where lower(json_extract(j.value, '$.repository')) = lower(?))";
  return db
    .prepare(`select c.* from conversations c where ${linked} and ${where.sql} order by c.started_at asc nulls last, c.path limit ?`)
    .all(repository, ...where.params, limit);
}

/** A conversation by session id. The same id can sit in two project directories (a copied or moved
 *  transcript): the one in `cwd` is preferred when given, else — or when none is there — the newest. `=` rather than
 *  `is`, so that no cwd given never prefers a copy that has none recorded. */
export function findConversation(db: DatabaseSync, id: string, cwd: string | null = null): Record<string, unknown> | null {
  return db.prepare("select * from conversations where id = ? order by coalesce(cwd = ?, 0) desc, ended_at desc nulls last limit 1").get(id, cwd) ?? null;
}

/** What a search matches with: an FTS5 phrase, or null to fall back to `like` (an escaped pattern),
 *  which the trigram index cannot serve under three characters. */
export interface SearchPattern {
  match: string | null;
  like: string;
}

/** Which conversation a turn belongs to: a transcript turn to the file it came from, a prompt-history
 *  row (no path) to every conversation with its session id. */
const OWNS_TURN = "c.id = t.conv and (t.path is null or t.path = c.path)";

const turnHit = (pattern: SearchPattern): string =>
  pattern.match === null ? "t.text like ? escape '\\'" : "t.id in (select rowid from turns_fts where turns_fts match ?)";

/** Conversations with a matching turn, newest first. A temporary conversation never matches by its
 *  text — not by a prompt-history row either, which may have arrived before it was known to be one. The matching conversations are found BEFORE
 *  joining anything: grouping the joined turns instead carried every match's text through the sort,
 *  which was most of the time a common word took. */
export function searchTurns(db: DatabaseSync, pattern: SearchPattern, filter: ConversationFilter, limit: number): Record<string, unknown>[] {
  const where = filterClause(filter);
  const sql = `with hits as (select distinct t.conv, t.path from turns t where ${turnHit(pattern)})
    select c.* from conversations c where c.key in (
      select owner.key from hits h join conversations owner on owner.id = h.conv and (h.path is null or h.path = owner.path)
      where owner.is_temporary = 0)
    and ${where.sql} order by c.ended_at desc nulls last limit ?`;
  return db.prepare(sql).all(pattern.match ?? pattern.like, ...where.params, limit);
}

/** The matching turns of each conversation named (by its row key), oldest first, for a snippet. */
export function matchingTurns(db: DatabaseSync, pattern: SearchPattern, conversationKeys: readonly number[]): Record<string, unknown>[] {
  if (conversationKeys.length === 0) return [];
  const keys = conversationKeys.map(() => "?").join(", ");
  const sql = `select c.key as conv_key, t.text, t.role from turns t join conversations c on ${OWNS_TURN}
    where c.key in (${keys}) and ${turnHit(pattern)} order by t.id`;
  return db.prepare(sql).all(...conversationKeys, pattern.match ?? pattern.like);
}

export function searchTitles(db: DatabaseSync, pattern: SearchPattern, filter: ConversationFilter, limit: number): Record<string, unknown>[] {
  const where = filterClause(filter);
  const hit = pattern.match === null ? "c.title like ? escape '\\'" : "c.key in (select rowid from titles_fts where titles_fts match ?)";
  const sql = `select c.* from conversations c where ${hit} and ${where.sql} order by c.ended_at desc nulls last limit ?`;
  return db.prepare(sql).all(pattern.match ?? pattern.like, ...where.params, limit);
}

/** A row as the wire shape. Columns written by this file only, but read back through guards. */
export function conversationOfRow(row: Record<string, unknown>): LibraryConversation {
  return {
    id: readString(row.id),
    agent: agentOf(row.agent),
    title: stringOrNull(row.title),
    cwd: stringOrNull(row.cwd),
    gitBranch: stringOrNull(row.git_branch),
    prs: jsonArray(row.prs)
      .filter(isRecord)
      .map((pr) => ({ number: Number(pr.number), url: readString(pr.url), repository: readString(pr.repository) })),
    costUsd: nullableNumber(row.cost_usd),
    linesAdded: nullableNumber(row.lines_added),
    linesRemoved: nullableNumber(row.lines_removed),
    startedAt: nullableNumber(row.started_at),
    endedAt: nullableNumber(row.ended_at),
    skills: jsonArray(row.skills).filter((skill): skill is string => typeof skill === "string"),
    hookErrors: Number(row.hook_errors ?? 0),
    userTurns: Number(row.user_turns ?? 0),
    isSidechain: Number(row.is_sidechain) === 1,
    parentId: stringOrNull(row.parent_id),
    isTemporary: Number(row.is_temporary) === 1,
    entrypoint: stringOrNull(row.entrypoint),
  };
}

// Only claude is written today; a value from a future build reads as the agent it most likely is
// rather than failing the whole page.
const agentOf = (value: unknown): TerminalAgent => TERMINAL_AGENTS.find((agent) => agent === value) ?? "claude";

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function jsonArray(raw: unknown): unknown[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
