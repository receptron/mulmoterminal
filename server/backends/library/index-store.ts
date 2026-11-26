// The Library's index on disk (#3328): SQLite tables and every statement that touches them.
//
// The index is a copy of the agents' own files and nothing else, so any doubt about it — a schema
// from another build, a state that does not parse — is answered by dropping and re-reading, never by
// migrating. Several servers share one index under the same HOME; the `lease` row decides which of
// them writes, and every scan commits only if the file is still where that scan found it.
//
// The database handle is passed in, so the specs run the same statements on `:memory:`.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { readString } from "../../../common/readString.js";
import type { LibraryConversation, LibraryTurnRole } from "../../../common/library.js";
import { conversationTitle, isConversationState, type ConversationState, type IndexedTurn } from "./conversation-fold.js";
import type { HistoryPrompt } from "./history-fold.js";
import { spendTotals, type ReplyWeight } from "./spend-fold.js";

/** Bump when a column or what a column means changes: the next open drops and rebuilds. */
export const LIBRARY_SCHEMA_VERSION = 8;
// A write that meets another process's lock waits SYNCHRONOUSLY, with the event loop stopped, for up
// to this long; a reader in WAL mode never waits. So it stays short: a write that gives up is a pass
// that runs again later, while a long wait is a frozen server.
const BUSY_TIMEOUT_MS = 100;
// Opening is the exception: two servers opening a new index at once both need the write lock to set
// it up, and that happens once, on the worker, before anything is waiting on an answer.
const OPEN_BUSY_TIMEOUT_MS = 5000;

const TABLES = ["files", "conversations", "titles_fts", "turns", "turns_fts", "replies", "lease"];

const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
create table if not exists files (path text primary key, kind text not null, size integer not null, mtime_ms real not null, scanned_to integer not null, head text not null, tail text, state text);
create table if not exists conversations (
  key integer primary key, path text not null unique, id text not null, agent text not null, parent_id text, title text, cwd text, git_branch text, prs text not null,
  cost_usd real, lines_added integer, lines_removed integer, started_at integer, ended_at integer, skills text not null,
  hook_errors integer not null, user_turns integer not null, is_sidechain integer not null, is_temporary integer not null, entrypoint text,
  memory_writes text not null default '[]', spend_models text not null default '{}');
create index if not exists conversations_id on conversations (id);
create index if not exists conversations_ended on conversations (ended_at);
create index if not exists conversations_cwd on conversations (cwd);
-- Only the few rows that recorded a PR: a PR lookup otherwise reads every conversation's links.
create index if not exists conversations_with_prs on conversations (started_at) where prs != '[]';
-- Likewise only the rows that wrote memory: looking up who wrote one reads just those.
create index if not exists conversations_with_memory on conversations (ended_at) where memory_writes != '[]';
-- And only the rows that ran a skill: counting skill use reads just those.
create index if not exists conversations_with_skills on conversations (ended_at) where skills != '[]';
create virtual table if not exists titles_fts using fts5 (title, content = 'conversations', content_rowid = 'key', tokenize = 'trigram');
create trigger if not exists conversations_ai after insert on conversations begin insert into titles_fts (rowid, title) values (new.key, new.title); end;
create trigger if not exists conversations_ad after delete on conversations begin
  insert into titles_fts (titles_fts, rowid, title) values ('delete', old.key, old.title); end;
create trigger if not exists conversations_au after update on conversations begin
  insert into titles_fts (titles_fts, rowid, title) values ('delete', old.key, old.title);
  insert into titles_fts (rowid, title) values (new.key, new.title); end;
-- path is the transcript a turn came from (null for a prompt-history row). Two projects can hold a
-- transcript with the same session id, so a transcript's turns are owned by its path, not its id.
create table if not exists turns (id integer primary key, conv text not null, path text, role text not null, at integer, text text not null);
create index if not exists turns_conv on turns (conv);
create index if not exists turns_path on turns (path);
create virtual table if not exists turns_fts using fts5 (text, content = 'turns', content_rowid = 'id', tokenize = 'trigram');
create trigger if not exists turns_ai after insert on turns begin insert into turns_fts (rowid, text) values (new.id, new.text); end;
create trigger if not exists turns_ad after delete on turns begin insert into turns_fts (turns_fts, rowid, text) values ('delete', old.id, old.text); end;
-- Each reply's weight in its 15-minute slot (spend-fold.ts), one row per reply id: a later record of the
-- same reply replaces it.
create table if not exists replies (path text not null, id text not null, at integer not null, model text not null, weight real not null,
  primary key (path, id)) without rowid;
create index if not exists replies_at on replies (at);
create table if not exists lease (id integer primary key check (id = 1), owner text, expires_ms integer, files_done integer not null default 0,
  files_total integer not null default 0, finished_ms integer);
insert or ignore into lease (id) values (1);
`;

export function prepareLibraryStore(db: DatabaseSync): void {
  // `synchronous = normal`: a commit lost to a power cut costs one file's re-read, and a full sync
  // per file is what made the first pass crawl.
  // The busy timeout first: every statement after it, the switch to WAL included, may meet the lock.
  db.exec(`pragma busy_timeout = ${String(OPEN_BUSY_TIMEOUT_MS)}; pragma journal_mode = wal; pragma synchronous = normal;`);
  // One transaction, so a second process setting up at the same moment waits and then finds it done.
  inTransaction(db, () => {
    db.exec("create table if not exists meta (key text primary key, value text not null)");
    const row = db.prepare("select value from meta where key = 'schema'").get();
    if (row?.value !== String(LIBRARY_SCHEMA_VERSION)) dropAll(db);
    db.exec(SCHEMA);
    db.prepare("insert or replace into meta (key, value) values ('schema', ?)").run(String(LIBRARY_SCHEMA_VERSION));
  });
  db.exec(`pragma busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
}

function dropAll(db: DatabaseSync): void {
  ["turns_ai", "turns_ad", "conversations_ai", "conversations_ad", "conversations_au"].forEach((trigger) => db.exec(`drop trigger if exists ${trigger}`));
  TABLES.forEach((table) => db.exec(`drop table if exists ${table}`));
}

/** Everything written in one transaction, or nothing. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("begin immediate");
  try {
    const result = work();
    db.exec("commit");
    return result;
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}

/** Reads that must see one snapshot. In WAL mode a deferred transaction holds its first read's view
 *  until it ends, and a reader never waits on a writer. */
export function inReadSnapshot<T>(db: DatabaseSync, read: () => T): T {
  db.exec("begin");
  try {
    return read();
  } finally {
    db.exec("commit");
  }
}

// ---- where each file was left -------------------------------------------------------------

export interface FileMark {
  size: number;
  mtimeMs: number;
  scannedTo: number;
  /** A hash of the file's first bytes, which a file replaced by another one does not share. */
  head: string;
  /** A hash of the bytes just before `scannedTo`, or null when none was recorded (a pass stopped
   *  between batches). A file rewritten in place does not keep it. */
  tail: string | null;
  state: ConversationState | null;
}

export function readFileMark(db: DatabaseSync, path: string): FileMark | null {
  const row = db.prepare("select size, mtime_ms, scanned_to, head, tail, state from files where path = ?").get(path);
  if (row === undefined) return null;
  return {
    size: Number(row.size),
    mtimeMs: Number(row.mtime_ms),
    scannedTo: Number(row.scanned_to),
    head: readString(row.head),
    tail: typeof row.tail === "string" ? row.tail : null,
    state: parseState(row.state),
  };
}

function parseState(raw: unknown): ConversationState | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isConversationState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface FileStampRead {
  size: number;
  mtimeMs: number;
}

/** What every scan must still be true of when it commits: this process holds the lease, and the
 *  file's offset is the one the scan started from (null: the file had no row). Either one moved means
 *  another process got there first, and its rows win. */
export interface ScanClaim {
  owner: string;
  expectedScannedTo: number | null;
}

function claimHolds(db: DatabaseSync, path: string, claim: ScanClaim): boolean {
  const owner = db.prepare("select owner from lease where id = 1").get()?.owner;
  return owner === claim.owner && (readFileMark(db, path)?.scannedTo ?? null) === claim.expectedScannedTo;
}

// ---- conversations ------------------------------------------------------------------------

export interface TranscriptScan extends ScanClaim {
  path: string;
  id: string;
  agent: LibraryConversation["agent"];
  parentId: string | null;
  isTemporary: boolean;
  stamp: FileStampRead;
  head: string;
  to: number;
  /** Read from the start: the conversation's old rows go first. */
  restart: boolean;
  state: ConversationState;
  turns: IndexedTurn[];
  /** The replies the batch read, each replacing any row of the same id. */
  replies: ReplyWeight[];
}

/** Commits the scan, or answers false when its claim no longer holds. */
export function applyTranscriptScan(db: DatabaseSync, scan: TranscriptScan): boolean {
  return inTransaction(db, () => {
    if (!claimHolds(db, scan.path, scan)) return false;
    // A conversation found to be temporary only once its cwd arrived keeps no text from before.
    if (scan.restart || scan.isTemporary) deleteTranscriptTurns(db, scan.path);
    if (scan.restart) deleteReplies(db, scan.path);
    writeFileMark(db, scan.path, "transcript", { ...scan.stamp, head: scan.head, scannedTo: scan.to }, JSON.stringify(scan.state));
    writeConversation(db, scan);
    insertTurns(db, scan.id, scan.path, scan.turns);
    writeReplies(db, scan.path, scan.replies);
    return true;
  });
}

function writeFileMark(db: DatabaseSync, path: string, kind: string, mark: Omit<FileMark, "state" | "tail">, state: string | null): void {
  db.prepare("insert or replace into files (path, kind, size, mtime_ms, scanned_to, head, state) values (?, ?, ?, ?, ?, ?, ?)").run(
    ...[path, kind, mark.size, mark.mtimeMs, mark.scannedTo, mark.head, state],
  );
}

const CONVERSATION_COLUMNS = [
  ...["path", "id", "agent", "parent_id", "title", "cwd", "git_branch", "prs", "cost_usd", "lines_added", "lines_removed"],
  ...["started_at", "ended_at", "skills", "hook_errors", "user_turns", "is_sidechain", "is_temporary", "entrypoint", "memory_writes", "spend_models"],
];

function writeConversation(db: DatabaseSync, scan: TranscriptScan): void {
  const s = scan.state;
  const values: SQLInputValue[] = [scan.path, scan.id, scan.agent, scan.parentId, conversationTitle(s), s.cwd, s.gitBranch, JSON.stringify(s.prs)];
  values.push(s.costUsd, s.linesAdded, s.linesRemoved, s.startedAt, s.endedAt, JSON.stringify(s.skills), s.hookErrors, s.userTurns);
  values.push(s.isSidechain || scan.parentId !== null ? 1 : 0, scan.isTemporary ? 1 : 0, s.entrypoint, JSON.stringify(s.memoryWrites));
  values.push(JSON.stringify(spendTotals(s.spend)));
  // An upsert rather than `insert or replace`: a replace deletes the row without firing the delete
  // trigger, which would leave its old title in the title index.
  const updates = CONVERSATION_COLUMNS.slice(1).map((column) => `${column} = excluded.${column}`);
  const placeholders = CONVERSATION_COLUMNS.map(() => "?").join(", ");
  db.prepare(
    `insert into conversations (${CONVERSATION_COLUMNS.join(", ")}) values (${placeholders}) on conflict (path) do update set ${updates.join(", ")}`,
  ).run(...values);
}

function insertTurns(db: DatabaseSync, conv: string, path: string, turns: readonly { role: LibraryTurnRole; text: string; at: number | null }[]): void {
  const insert = db.prepare("insert into turns (conv, path, role, at, text) values (?, ?, ?, ?, ?)");
  turns.forEach((turn) => insert.run(conv, path, turn.role, turn.at, turn.text));
}

function writeReplies(db: DatabaseSync, path: string, replies: readonly ReplyWeight[]): void {
  const write = db.prepare(`insert into replies (path, id, at, model, weight) values (?, ?, ?, ?, ?)
    on conflict (path, id) do update set at = excluded.at, model = excluded.model, weight = excluded.weight`);
  replies.forEach((reply) => write.run(path, reply.id, reply.at_ms, reply.model, reply.weight));
}

function deleteReplies(db: DatabaseSync, path: string): void {
  db.prepare("delete from replies where path = ?").run(path);
}

// The prompt-history rows have no path: they are the history file's, and outlive a re-read.
function deleteTranscriptTurns(db: DatabaseSync, path: string): void {
  db.prepare("delete from turns where path = ?").run(path);
}

/** Drops every transcript the last walk did not see: the index holds nothing its source does not.
 *  Only while `owner` still holds the lease — a pass that lost it may be looking at a listing taken
 *  before another process indexed files it never saw. Answers how many went, or null for "not ours". */
export function removeMissingTranscripts(db: DatabaseSync, owner: string, seen: ReadonlySet<string>): number | null {
  return inTransaction(db, () => {
    if (db.prepare("select owner from lease where id = 1").get()?.owner !== owner) return null;
    const gone = db
      .prepare("select path from files where kind = 'transcript'")
      .all()
      .map((row) => readString(row.path))
      .filter((path) => !seen.has(path));
    gone.forEach((path) => removeTranscript(db, path));
    return gone.length;
  });
}

function removeTranscript(db: DatabaseSync, path: string): void {
  deleteTranscriptTurns(db, path);
  deleteReplies(db, path);
  db.prepare("delete from conversations where path = ?").run(path);
  db.prepare("delete from files where path = ?").run(path);
}

// ---- prompt history -----------------------------------------------------------------------

export interface HistoryScan extends ScanClaim {
  path: string;
  stamp: FileStampRead;
  head: string;
  to: number;
  restart: boolean;
  prompts: HistoryPrompt[];
}

export function applyHistoryScan(db: DatabaseSync, scan: HistoryScan): boolean {
  return inTransaction(db, () => {
    if (!claimHolds(db, scan.path, scan)) return false;
    if (scan.restart) db.prepare("delete from turns where role = 'prompt'").run();
    writeFileMark(db, scan.path, "history", { ...scan.stamp, head: scan.head, scannedTo: scan.to }, null);
    const insert = db.prepare("insert into turns (conv, role, at, text) values (?, 'prompt', ?, ?)");
    scan.prompts.forEach((prompt) => insert.run(prompt.sessionId, prompt.at, prompt.text));
    return true;
  });
}

// ---- who indexes, and how far it got --------------------------------------------------------

/** Forgets the prompt history once its file is gone — the index holds nothing its source does not.
 *  Only for the lease holder, like every other write a pass makes. */
export function removeHistory(db: DatabaseSync, owner: string, path: string): boolean {
  return inTransaction(db, () => {
    if (db.prepare("select owner from lease where id = 1").get()?.owner !== owner) return false;
    db.prepare("delete from turns where role = 'prompt'").run();
    db.prepare("delete from files where path = ?").run(path);
    return true;
  });
}

/** Records where a finished scan stopped reading — only while `owner` holds the lease and the row
 *  still ends there, so a scan by another process is never given this one's tail. */
export function recordTail(db: DatabaseSync, owner: string, path: string, scannedTo: number, tail: string): void {
  db.prepare("update files set tail = ? where path = ? and scanned_to = ? and (select owner from lease where id = 1) = ?").run(tail, path, scannedTo, owner);
}

/** Extends the lease only while `owner` still holds it. Never takes a free one: a pass that lost the
 *  lease part-way must stop, because its listing predates whatever the other process did meanwhile,
 *  and taking the lease again would let it act on that stale listing. */
export function renewLease(db: DatabaseSync, owner: string, now_ms: number, ttl_ms: number): boolean {
  return Number(db.prepare("update lease set expires_ms = ? where id = 1 and owner = ?").run(now_ms + ttl_ms, owner).changes) === 1;
}

/** Takes the lease when it is free, expired, or already ours — at the START of a pass only. */
export function takeLease(db: DatabaseSync, owner: string, now_ms: number, ttl_ms: number): boolean {
  const taken = db
    .prepare("update lease set owner = ?, expires_ms = ? where id = 1 and (owner is null or owner = ? or expires_ms < ?)")
    .run(owner, now_ms + ttl_ms, owner, now_ms);
  return Number(taken.changes) === 1;
}

export function recordProgress(db: DatabaseSync, owner: string, done: number, total: number): void {
  db.prepare("update lease set files_done = ?, files_total = ? where id = 1 and owner = ?").run(done, total, owner);
}

export function finishLease(db: DatabaseSync, owner: string, now_ms: number): void {
  db.prepare("update lease set owner = null, expires_ms = null, finished_ms = ? where id = 1 and owner = ?").run(now_ms, owner);
}

export interface LeaseRow {
  owner: string | null;
  expiresMs: number | null;
  filesDone: number;
  filesTotal: number;
  finishedMs: number | null;
}

export function readLease(db: DatabaseSync): LeaseRow {
  const row = db.prepare("select owner, expires_ms, files_done, files_total, finished_ms from lease where id = 1").get() ?? {};
  return {
    owner: typeof row.owner === "string" ? row.owner : null,
    expiresMs: nullableNumber(row.expires_ms),
    filesDone: Number(row.files_done ?? 0),
    filesTotal: Number(row.files_total ?? 0),
    finishedMs: nullableNumber(row.finished_ms),
  };
}

export const nullableNumber = (value: unknown): number | null => (typeof value === "number" || typeof value === "bigint" ? Number(value) : null);
