// Reading one session's transcript for the phone's transcript view (#1751).
//
// Separate from session-reads.ts because neither reader there fits: `sessionTimeline` folds the
// whole file for tool events, and `sessionLastTurn` reads a fixed 4 MB tail for ONE exchange. This
// window is a line budget over whole turns, and it needs its own widening rule.
//
// Nothing here is cached or folded incrementally: the first cold read of `transcript-fold` is the
// whole file, and a live session of 107 MB exists on this machine. The tail is read directly
// instead, measured at 24.3 ms for 4 MB against 39.3 ms for the tmux capture the phone already pays.
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { SESSION_ID_RE } from "../../config/env.js";
import { isRecord } from "../../../common/isRecord.js";
import { hasErrnoCode, messageOf } from "../../errors.js";
import { forEachJsonlRecordIn } from "../../infra/fs/jsonl-file.js";
import { transcriptIdOf } from "./cleared-transcripts.js";
import { emptyTranscriptScan, foldTranscriptView, trackTurnStarts, transcriptViewOf, type TranscriptScan } from "./transcript-view.js";
import type { TranscriptPage, TranscriptView } from "../../../common/transcriptView.js";
import { createCodexFold } from "./transcript-view-codex.js";
import { createCursorFold } from "./transcript-view-cursor.js";
import {
  antigravityConversations,
  antigravityConversationsHydrated,
  codexRollouts,
  codexRolloutsHydrated,
  museConversations,
  museConversationsHydrated,
} from "../registry.js";
import { grokSessionsRoot, isGrokConversationId } from "../../agents/grok/grok-session.js";
import { grokChatHistoryPath } from "../../agents/grok/grok-sessions.js";
import { createGrokFold } from "./transcript-view-grok.js";
import { createAntigravityFold } from "./transcript-view-antigravity.js";
import { antigravityBrainRoot, isAntigravityConversationId } from "../../agents/antigravity/antigravity-session.js";
import { antigravityTranscriptPath } from "../../agents/antigravity/antigravity-sessions.js";
import { claudeTranscriptFile, codexSessionRoot } from "../session-home.js";
import { codexRolloutPath } from "../../agents/codex/codex-sessions.js";
import { cursorTranscriptPath } from "../../agents/cursor/cursor-sessions.js";
import { listCopilotTurns } from "../../agents/copilot/copilot-sessions.js";
import { foldCopilotRow } from "./transcript-view-copilot.js";
import type { SqliteRow } from "../../agents/sqlite-read.js";
import type { SessionAgent } from "../../../common/sessionAgent.js";

/** How much of the transcript's end is read, and how far that may widen (see readWindow).
 *
 *  Injected with a default, like every other bound in this area, so a spec can exercise the widening
 *  and the ceiling without writing a 32 MB fixture. */
export interface TranscriptWindow {
  tailBytes: number;
  maxTailBytes: number;
}

export const DEFAULT_TRANSCRIPT_WINDOW: TranscriptWindow = {
  // Measured: reaching 250 logical lines needs a median of 609 KB and at most 1457 KB, so this is
  // 2.8x the worst case seen — and it reads in 24.3 ms on a 107 MB file.
  tailBytes: 4 * 1024 * 1024,
  // How far the window will widen looking for a turn boundary, and no further. The largest single
  // record measured is 4,761,619 characters (#1692), so this is seven times that; past it, a session
  // with no boundary in 32 MB is reported as too-large rather than as empty.
  maxTailBytes: 32 * 1024 * 1024,
};

// Not merely a nicety on top of SESSION_ID_RE: the regexp is what makes the id safe, and this is
// what still holds if someone later loosens it.
const isInside = (dir: string, file: string): boolean => {
  const rel = path.relative(dir, path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

const isMissingFile = (e: unknown): boolean => hasErrnoCode(e) && e.code === "ENOENT";

const NEWLINE = 0x0a;

/** Whether `from` is genuinely the first byte of a line.
 *
 *  `forEachJsonlRecordIn` drops the leading line of a range it was not told starts at one, and that
 *  is the right default: a window picked by arithmetic almost always opens INSIDE a line, and half a
 *  line is not JSON. "Almost always" is not always. When `size - tail` happens to land exactly on a
 *  boundary the dropped line is a WHOLE record — and if it was a user prompt, its exchange is folded
 *  into the previous turn, or the window loses its only boundary and a perfectly readable session is
 *  reported as `too-large` (Codex, PR #1776).
 *
 *  One byte answers it, which is why the check is cheaper than the bug. */
async function startsAtLine(handle: FileHandle, from: number): Promise<boolean> {
  if (from === 0) return true;
  const byte = Buffer.alloc(1);
  const { bytesRead } = await handle.read(byte, 0, 1, from - 1);
  return bytesRead === 1 && byte[0] === NEWLINE;
}

/** The bytes after the last newline, folded when they are a whole record.
 *
 *  A `to`-bounded fold never yields the last line of its range, and that is right at an arbitrary
 *  cut: half a record and a finished one look the same there. Here the cut is the SIZE, so the only
 *  thing past the last newline is one line — and JSON says which of the two it is, exactly as the
 *  fold decides at EOF. Without this, bounding the scan at the snapshot silently dropped a complete
 *  final record whose newline had not landed yet, which for a one-turn session is the whole view
 *  (Codex, PR #1776).
 *
 *  Bounded by the snapshot like everything else: what lies between is at most one record. */
async function foldFinalLine(handle: FileHandle, from: number, to: number, onRecord: (record: Record<string, unknown>) => void): Promise<void> {
  if (to <= from) return;
  const buf = Buffer.alloc(to - from);
  const { bytesRead } = await handle.read(buf, 0, buf.length, from);
  const line = buf.subarray(0, bytesRead).toString("utf8").trim();
  if (!line) return;
  try {
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) onRecord(parsed);
  } catch {
    // Half a record — the writer is mid-line. The next poll picks it up whole.
  }
}

// A window with no turn boundary in it is not a view: the whole point is turns, and the newest one
// must be complete. It happens when a SINGLE record is bigger than the window — the range fold drops
// the partial line it starts inside, taking that record with it — so the answer is to widen.
//
// The condition is "no boundary", not "no records": for `[record bigger than the window][a small
// assistant record]` a records-based test finds one and stops, and the view then arrives missing the
// very turn it promised. Stating the guarantee is what keeps this correct as shapes change.
//
// Widening stops for two different reasons, and they are two different answers. `from === 0` means
// the whole file has been read and simply holds no turn, which is not a size problem. Reaching the
// ceiling with `from > 0` means there is more file we refuse to read.
async function readWindow(
  handle: FileHandle,
  bounds: { end: number; atEof: boolean },
  tail: number,
  window: TranscriptWindow,
  source: FileTranscriptSource,
): Promise<TranscriptPage> {
  const { end, atEof } = bounds;
  const from = Math.max(0, end - tail);
  const scan = emptyTranscriptScan();
  // Per WINDOW, not per file: a widened re-read folds the same bytes from the start, and a fold
  // carrying state from the abandoned pass (codex's double-write guard does) would judge the first
  // record of the new pass against the last record of the old one.
  const turns = trackTurnStarts(scan, source.createFold(scan));
  const atLineStart = await startsAtLine(handle, from);
  // `to: end` — the window ENDS at the size that was stat'd (or at the cursor, for an older page).
  // Without it the fold reads until EOF, and this file is being appended to WHILE it is read: a live
  // session writes every 2-17 seconds, in records that reach megabytes, so a read nominally bounded
  // at 4 MB follows the writer for as long as the writer keeps going. Bounding it at the snapshot
  // also makes a widened re-read fold the same bytes the first one did, rather than a file that
  // moved underneath (Codex, PR #1776).
  const stopped = await forEachJsonlRecordIn(handle, { from, to: end, atLineStart }, turns.fold);
  // Only where `end` IS the file's end: past a cursor there is nothing between the last newline and
  // the cut, because the cursor is itself a line start. `stopped` is that final line's own offset.
  if (atEof) await foldFinalLine(handle, stopped, end, (record) => turns.fold(record, stopped));
  if (scan.turns.length > 0) return pageOf(scan, turns.keys(), { moreBefore: from > 0, mint: (key) => cursorFor(source.agent, key) });
  // The whole remaining head has been read and holds no turn. Two different sentences: on the first
  // page that is a file with no conversation in it, and past a cursor it is simply the end of the
  // walk backwards — an empty page rather than a view that says the session has nothing.
  if (from === 0) return { view: atEof ? { status: "none" } : emptyPageView(), older: null };
  if (tail >= window.maxTailBytes) return { view: { status: "too-large" }, older: null };
  // Clamped, so the ceiling is the ceiling: doubling past it would read more than this says it will
  // whenever the two are not a power of two apart (CodeRabbit, PR #1776).
  return readWindow(handle, bounds, Math.min(tail * 2, window.maxTailBytes), window, source);
}

/** A page that reached the start of what can be read. `ok` rather than `none`: the client is
 *  appending older turns to a conversation it is already showing, and `none` there would read as
 *  "this session has nothing" over a screen full of it. */
const emptyPageView = (): TranscriptView => ({ status: "ok", turns: [], truncated: false });

/** A scan as a PAGE: the view, and the cursor for whatever lies before it.
 *
 *  THE CURSOR IS THE OLDEST TURN THE VIEW SHOWS, not the oldest the scan held, and the difference is
 *  a hole in the middle of a conversation. Two separate rules drop turns from the front — the line
 *  budget inside the fold, and the byte cap inside `transcriptViewOf` — and only the first is
 *  visible on the scan. A cursor taken from the scan pages straight past everything the second one
 *  dropped, and the walk still ends tidily at the head, so nothing anywhere says a turn was lost.
 *  Measured on a real 8.9 MB transcript: 8 of 31 turns were unreachable that way.
 *
 *  `moreBefore` is what the SOURCE knows and the scan cannot say: a byte window that opened past the
 *  file's head, or a query that left older rows behind. Without it, a page whose every turn fits
 *  would claim to be the start of the conversation. */
function pageOf(
  scan: TranscriptScan,
  keys: readonly number[],
  source: { moreBefore: boolean; mint: (key: number | null) => string | null; floor?: number | null },
): TranscriptPage {
  const view = transcriptViewOf(scan, source.moreBefore);
  const shown = view.status === "ok" ? view.turns.length : 0;
  const hasOlder = shown < scan.turns.length || scan.truncated || source.moreBefore;
  // `floor` is where the walk resumes when this page kept NO turn at all — the oldest key the source
  // actually read. Without it a page whose every row rendered nothing (copilot rows with an empty
  // prompt AND an empty reply) ends the walk at a cursor of null, and the pane says "the start of
  // this conversation" with older rows still in the table (Claude review, round 1). A file source
  // cannot reach this: `readWindow` widens on an empty scan until it hits byte 0 or the ceiling.
  const oldestShown = keys[keys.length - shown] ?? source.floor ?? null;
  return { view, older: hasOlder ? source.mint(oldestShown) : null };
}

// ── which agent's log answers, and how it is chosen (#1822) ───────────────────────────────────
//
// THE AGENT IS NOT ASKED. That is the constraint the whole shape follows from, and it predates the
// second reader: a claude session that outlived a server restart reports its agent as `shell`,
// because a claude pane's `pane_current_command` is a version string (`2.1.233`) that
// `agentFromPaneCommand` has no entry for. A reader chosen by `agentOfSession` would therefore lose
// the conversation view on every restarted claude cell — the exact regression this file's original
// comment warned about.
//
// So each source is asked whether IT has a file for this (cwd, id), in order, and the first that
// does answers. That is the generalisation of what one reader already did by asking for
// `<id>.jsonl`: file existence is a fact, and the agent is a guess.
//
// Claude is first because it is the cheapest question (one path join) and the common case. A source
// whose `locate` is expensive belongs later in the list.
//
// THREE of the four keep a FILE and one keeps a TABLE, which is why this is a union rather than one
// shape. A file source is read by locating it and folding a byte window off its tail; copilot has no
// file to locate and no tail to read — its window is `ORDER BY turn_index DESC LIMIT n`. What the
// two have in common is the SCAN, so that is where they meet: both hand the same `TranscriptScan` to
// the same `transcriptViewOf`, and the budget, the byte cap and the eviction rule are shared by
// construction rather than by each reader remembering them.
export interface FileTranscriptSource {
  kind: "file";
  agent: SessionAgent;
  /** This agent's transcript for the session, or null when it keeps none. Returning a path is not
   *  a claim that it EXISTS — the caller opens it and moves on if it does not. */
  locate: (cwd: string, id: string) => Promise<string | null>;
  /** A fold for one scan. A factory rather than a function because a fold may need state across
   *  records (codex's double-write guard). */
  createFold: (scan: TranscriptScan) => (record: Record<string, unknown>) => void;
}

/** One page of a query source's turns.
 *
 *  `keys` is parallel to `scan.turns` — the cursor key of the row that opened each. `more` is the one
 *  thing only the source knows: that its read left older rows behind. Everything else about the
 *  cursor is decided by `pageOf`, so a file source and a query source cannot answer it differently. */
export interface QueryTranscriptPage {
  scan: TranscriptScan;
  keys: readonly number[];
  more: boolean;
  /** The oldest key this read TOUCHED, whether or not it produced a turn. It is what the walk
   *  resumes from when a page renders nothing — see `pageOf`. Null when the read touched nothing. */
  floor: number | null;
}

export interface QueryTranscriptSource {
  kind: "query";
  agent: SessionAgent;
  /** This session's turns from the agent's own index, or null when it holds none — the same answer
   *  an empty file gives, so the search moves on to the next source rather than stopping.
   *
   *  It takes `cwd` for a reason a file source gets for free: a machine-global index must scope the
   *  read to the directory itself, or a session id from another project is readable here by hand.
   *
   *  `before` is the key handed back from a previous page, or null for the newest one (#2112). */
  scan: (cwd: string, id: string, before: number | null) => Promise<QueryTranscriptPage | null>;
}

export type TranscriptSource = FileTranscriptSource | QueryTranscriptSource;

const claudeSource: FileTranscriptSource = {
  kind: "file",
  agent: "claude",
  locate: (cwd, id) => {
    const file = claudeTranscriptFile(cwd, id);
    const dir = path.dirname(file);
    // Not merely a nicety on top of SESSION_ID_RE: the regexp is what makes the id safe, and this is
    // what still holds if someone later loosens it.
    return Promise.resolve(isInside(dir, file) ? file : null);
  },
  createFold: (scan) => (record) => foldTranscriptView(scan, record),
};

const codexSource: FileTranscriptSource = {
  kind: "file",
  agent: "codex",
  // Two hops, and the mapping is the reason: codex mints its own rollout id, so the session key the
  // browser knows is not the file's name. `codexRollouts` is that mapping, read off disk — hence
  // the await, without which a request served during startup falls through to the key and names no
  // rollout. `codexRolloutPath` scans the day tree and answers null for an id it cannot find, which
  // is also the containment check: it only ever joins a name it read from a directory under `root`.
  locate: async (_cwd, id) => {
    await codexRolloutsHydrated;
    const rolloutId = codexRollouts.get(id)?.conversationId ?? id;
    return codexRolloutPath(codexSessionRoot(id), rolloutId);
  },
  createFold: createCodexFold,
};

const cursorSource: FileTranscriptSource = {
  kind: "file",
  agent: "cursor",
  // The session key IS cursor's chat id (`--resume <uuid>` with a uuid this server invents), so
  // there is no mapping to wait for. What the lookup costs instead is a walk: a chat lives under
  // `~/.cursor/projects/<slug>/agent-transcripts/<id>/`, and the slug is a truncated-and-hashed
  // form of the path that cannot be reconstructed — so each project directory is asked what it
  // stands for (cursor-sessions.ts).
  locate: (cwd, id) => cursorTranscriptPath(cwd, id),
  createFold: createCursorFold,
};

const grokSource: FileTranscriptSource = {
  kind: "file",
  agent: "grok",
  // No mapping: the session key IS grok's conversation id (`--session-id`), and conversations are
  // filed under the cwd, so the path itself binds the read to this directory. The id is checked for
  // shape before it is joined into that path.
  locate: (cwd, id) => Promise.resolve(isGrokConversationId(id) ? grokChatHistoryPath(grokSessionsRoot(), cwd, id) : null),
  createFold: createGrokFold,
};

const antigravitySource: FileTranscriptSource = {
  kind: "file",
  agent: "antigravity",
  // Resolved like codex's rollout and agy's own badge: agy mints the conversation id, so the session
  // key goes through the mapping recorded at spawn (hence the await — a request racing boot would
  // read an empty map), and the key itself is the fallback for one taken from the conversation list.
  // The id is checked for shape before it is joined into the path.
  locate: async (_cwd, id) => {
    await antigravityConversationsHydrated;
    const conversationId = antigravityConversations.get(id)?.conversationId ?? id;
    return isAntigravityConversationId(conversationId) ? antigravityTranscriptPath(antigravityBrainRoot(), conversationId) : null;
  },
  createFold: createAntigravityFold,
};

const copilotSource: QueryTranscriptSource = {
  kind: "query",
  agent: "copilot",
  // One indexed query against copilot's own machine-global store, scoped to the directory inside
  // the SQL (listCopilotTurns) rather than after it — every other source is bound to a cwd by where
  // its file lives, and this one would otherwise read another project's conversation into this cell.
  //
  // A read that left an older turn behind is marked truncated here rather than in the fold: the
  // fold's own `truncated` means "the budget evicted something", and this is the different statement
  // that the READ stopped early. `transcriptViewOf` ORs the two, so the phone sees one answer.
  scan: async (cwd, id, before) => {
    const { turns, more } = await listCopilotTurns(id, cwd, before);
    if (turns.length === 0) return null;
    const scan = emptyTranscriptScan();
    const tracked = trackTurnStarts<SqliteRow>(scan, (row) => foldCopilotRow(scan, row));
    turns.forEach((row) => tracked.fold(row, copilotTurnIndex(row)));
    // `more` is passed on rather than folded into `scan.truncated` here: `pageOf` ORs it into the
    // view's own `truncated` exactly as a file window's mid-file start is, so the two kinds of source
    // report an incomplete read the same way.
    //
    // `floor` is the oldest row READ — the rows arrive oldest first, so it is the first one. It is
    // what keeps the walk moving when a whole page of rows renders nothing.
    return { scan, keys: tracked.keys(), more, floor: turns[0] === undefined ? null : copilotTurnIndex(turns[0]) };
  },
};

/** A row's `turn_index` as the cursor key. Zero for a row that has none: the column is `NOT NULL`,
 *  so this is unreachable through copilot's own schema, and a cursor of 0 stops the walk rather than
 *  paging on a number that means nothing. */
const copilotTurnIndex = (row: SqliteRow): number => (typeof row.turn_index === "number" ? row.turn_index : 0);

/** In the order they are asked.
 *
 *  Claude first because it is the cheapest question and the common case. Grok is one path join, as
 *  claude is, and antigravity one map lookup and a join, so both go before cursor. Cursor LAST OF THE FILE
 *  sources because its locate is the most expensive: a readdir of every cursor project plus a read
 *  of each one's `.workspace-trusted`, where claude joins one path and codex scans a day tree.
 *
 *  Copilot last of all, and for a different reason from cursor's: its cost is not a walk but a
 *  sqlite open, and `node:sqlite` is imported lazily on the first call (sqlite-read.ts). Asking it
 *  only after every file has missed keeps that import off the path the overwhelming majority of
 *  cells take. */
const TRANSCRIPT_SOURCES: readonly TranscriptSource[] = [claudeSource, codexSource, grokSource, antigravitySource, cursorSource, copilotSource];

/** Agents with no reader here yet, for the one question the sources cannot answer: is a session
 *  that matched nothing a session with nothing written, or one this host cannot read?
 *
 *  Derived from the source list rather than listed, so wiring a source removes it from here by
 *  construction. `shell` is excluded deliberately — a shell cell has no conversation and never
 *  will, so the screen IS its content rather than a fallback from something missing. */
/** Whether a reader here answers for this agent. Exported for the spec that pins `UNREAD_SOURCES`
 *  as its exact complement: asserted against a hand-written list instead, the assertion passes when
 *  a reader is wired and the agent is left in both lists — which is the one drift it exists to catch,
 *  and Codex demonstrated it passing (round 2). Derived from the source list either way, so there is
 *  no second place to keep in step. */
export const hasReader = (agent: SessionAgent): boolean => TRANSCRIPT_SOURCES.some((source) => source.agent === agent);

/** The agents with no reader, and how to ask their own stores whether they hold a session (#2116).
 *
 *  This exists because the caller's `agentOf` answers from the PROCESS — a live pty, or what tmux
 *  reports the pane is running — and both are gone once a session ends. From that moment a grok,
 *  muse or antigravity session was told "nothing has been written yet", which is a different and
 *  false sentence: their conversation exists, this host just cannot read it.
 *
 *  So the same principle the reader is built on applies here too: ASK THE STORE, NOT THE PROCESS.
 *  It answers from a map this server already hydrated off its own append log, which costs nothing.
 *
 *  Asked ONLY when every reader missed AND the process could not say — a live shell cell answers
 *  `shell` from its pty and never reaches here.
 *
 *  THE LIST MUST BE EXACTLY THE AGENTS `hasReader` SAYS NO TO. When #1822 gives one of them a
 *  reader, leaving it here would make a readable session report that it cannot be read; a spec pins
 *  the two lists against each other rather than trusting a comment. */
export interface UnreadSource {
  agent: SessionAgent;
  holds: (cwd: string, id: string) => Promise<boolean>;
}

export const UNREAD_SOURCES: readonly UnreadSource[] = [
  {
    agent: "muse",
    holds: async (_cwd, id) => {
      await museConversationsHydrated;
      return museConversations.has(id);
    },
  },
];

/** Which reader-less agent holds this session, or null when none does.
 *
 *  The sources are a PARAMETER for the same reason the byte window is one: what is left answers
 *  from a map this process hydrates from `~/.mulmoterminal`, and a spec that planted an entry there
 *  the way production does would be writing into the machine's real log — which is exactly what the
 *  first version of its spec did. Injected, the same test says the same thing and touches nothing. */
export async function unreadOwner(cwd: string, id: string, sources: readonly UnreadSource[] = UNREAD_SOURCES): Promise<SessionAgent | null> {
  for (const source of sources) {
    if (await source.holds(cwd, id)) return source.agent;
  }
  return null;
}

// ── the cursor a client pages with (#2112) ───────────────────────────────────────────────────
//
// OPAQUE to the client, and it names the SOURCE that minted it — `claude:4096`, `copilot:12`.
//
// The key alone is not enough, and neither is the kind of key. A byte offset and a `turn_index` are
// both small integers, so one spent against the other reads as a perfectly plausible number. But so
// does one file's byte offset spent against ANOTHER file's: the source that answers is chosen by
// asking each agent in turn whether it holds this session, and that answer can change between two
// pages — a transcript truncated to nothing, or removed, hands the walk to the next source, which
// would then serve an arbitrary position of a different agent's file with nothing failing
// (Claude review, round 1). Naming the agent makes that a refused cursor instead.
const CURSOR_RE = /^([a-z]+):(\d+)$/;

const cursorFor = (agent: SessionAgent, key: number | null): string | null => (key === null || key <= 0 ? null : `${agent}:${key}`);

/** The source and the key inside a cursor, or null when it is not one this host minted.
 *
 *  Exported so the route can reject a malformed cursor with a status rather than serving the newest
 *  page under it — a client that asked for "older" and was handed "newest" would append the turns it
 *  is already showing, forever. */
export function parseTranscriptCursor(raw: string): { source: string; key: number } | null {
  const match = CURSOR_RE.exec(raw);
  const source = match?.[1];
  const key = Number(match?.[2]);
  if (source === undefined || !Number.isSafeInteger(key)) return null;
  // The NAME is checked against the sources this host actually has, not merely against the shape.
  // Widening the pattern to carry an agent name made `z:1` well-formed, and a cursor that matches no
  // source is answered by every source starting from its newest end — which hands a client that
  // asked for "older" the page it is already showing, forever. That is the one reply this cursor
  // exists to prevent, so an unknown name is not a cursor.
  return TRANSCRIPT_SOURCES.some((candidate) => candidate.agent === source) ? { source, key } : null;
}

// There is no "this cursor is not mine, carry on" case, and that absence is the point. Treating a
// mismatch as "no cursor" left the probed source reading its NEWEST page — so a walk whose answering
// source changed between pages appended another agent's newest turns, and a client that asked for
// "older" was handed the page it already had (Codex, round 2). The cursor NAMES the source that may
// answer it, so the selection happens once, in sessionTranscriptPage, and a source that is not the
// named one is never asked at all.

/** Ask ONE source, whichever kind it is, or null when it has nothing here.
 *
 *  The two kinds converge on the SCAN and not before it: a file source reads a byte window and folds
 *  records into one, a query source builds one from rows. `transcriptViewOf` then applies the byte
 *  cap and decides the status for both, so neither reader owns a copy of the budget. */
function pageFromSource(source: TranscriptSource, cwd: string, id: string, before: number | null, window: TranscriptWindow): Promise<TranscriptPage | null> {
  return source.kind === "query" ? pageFromQuery(source, cwd, id, before) : pageFromFile(source, cwd, id, before, window);
}

/** Read ONE source's index, or null when it holds nothing for this session — the same answer an
 *  empty file gives, so the search moves on rather than stopping here.
 *
 *  `false` for `windowStartedMidFile`: a query source has no window that can open mid-turn. Where
 *  its read DID stop early it says so on the scan itself, which `transcriptViewOf` ORs in. */
async function pageFromQuery(source: QueryTranscriptSource, cwd: string, id: string, before: number | null): Promise<TranscriptPage | null> {
  const page = await source.scan(cwd, id, before);
  return page === null ? null : pageOf(page.scan, page.keys, { moreBefore: page.more, mint: (key) => cursorFor(source.agent, key), floor: page.floor });
}

/** Read ONE source's file, or null when it has nothing here. `before` is the cursor's KEY — a byte
 *  offset this same source minted, because only the source a cursor names is ever asked. */
async function pageFromFile(
  source: FileTranscriptSource,
  cwd: string,
  id: string,
  before: number | null,
  window: TranscriptWindow,
): Promise<TranscriptPage | null> {
  const file = await source.locate(cwd, id);
  if (file === null) return null;
  let handle: FileHandle | null = null;
  try {
    // A HANDLE, not the path, and it is opened once for every read below. The window is read two to
    // four times when it has to widen, and a path is re-resolved each time — so a `/clear` or a
    // `--resume` between two of them would answer with one file's size and another file's records.
    handle = await fs.open(file, "r");
    const { size } = await handle.stat();
    // An empty file is this source having nothing to say, not the end of the search: a codex cell
    // whose rollout has been created but not written to must not stop claude being asked. `none` is
    // decided once, by the caller, when every source has answered.
    if (size === 0) return null;
    // Clamped to the size that was just stat'd. A cursor outlives the read that minted it, and the
    // file it points into can be replaced (`/clear`) or rewritten shorter in between — reading from
    // a byte past the end would answer an empty page and end the walk early, where clamping reads
    // the end of whatever file is there now.
    const end = before === null ? size : Math.min(before, size);
    if (end <= 0) return { view: emptyPageView(), older: null };
    // `return await`, not `return`: without it the handle is closed while the read is still running.
    return await readWindow(handle, { end, atEof: end === size }, window.tailBytes, window, source);
  } catch (e) {
    if (isMissingFile(e)) return null; // this agent keeps no file for this session — ask the next
    console.error(`[transcript-view] ${file}: ${messageOf(e)}`);
    return { view: { status: "none" }, older: null };
  } finally {
    // Polled every 5 seconds per open session, so one leaked descriptor is not one leak — it is a
    // slow climb to EMFILE. Closed on every path: the widened giveaway, the early return, the throw.
    //
    // Its own rejection is swallowed: an awaited throw in `finally` REPLACES what the `try` already
    // produced, so a failing close would turn a conversation that read perfectly well into an error
    // on the phone. The descriptor is gone either way (CodeRabbit, PR #1776).
    await handle?.close().catch((e: unknown) => console.error(`[transcript-view] close ${file}: ${messageOf(e)}`));
  }
}

/** What the caller knows that the files do not, for the one question file existence cannot answer.
 *  Injected rather than imported: `agentOfSession` lives in server/index.ts, which imports this. */
export interface TranscriptViewDeps {
  window?: TranscriptWindow;
  /** The reader-less agents' stores, for the one question `agentOf` cannot answer once the process
   *  is gone (#2116). Injected like the window above, and for the same reason: the real ones are
   *  maps hydrated from `~/.mulmoterminal`, so a spec exercising them through production's own
   *  writer would append to the machine's real log. */
  unreadSources?: readonly UnreadSource[];
  /** This session's agent, when the host knows it. Consulted ONLY after every source has missed —
   *  never to choose a reader (see TranscriptSource). */
  agentOf?: (id: string) => SessionAgent | null;
}

/** The phone's view of `id`'s conversation, from whichever hosted agent's log holds it.
 *
 *  `cwd` is the SESSION's directory, resolved by the caller. An empty one means "this host does not
 *  know that session" — never "look here": `projectSessionsDir("")` resolves against the server
 *  process's own directory, so an unknown id would be answered with whatever transcript of the same
 *  name happens to sit beside the server.
 *
 *  Four answers, and they are four different sentences to a person:
 *
 *    `ok`            a conversation
 *    `cleared`       the user ended this one with /clear (claude's own state)
 *    `too-large`     no turn boundary inside the ceiling
 *    `not-supported` this session's agent keeps a conversation that no reader here reads YET
 *    `none`          nothing written, or nothing this host can find
 *
 *  The phone falls back to the screen for all but the first, so the distinction buys a sentence
 *  rather than a behaviour — and `not-supported` also names a thing to go and implement, which
 *  `none` silently did not (#1822). */
export async function sessionTranscriptView(cwd: string, id: string, deps: TranscriptViewDeps | TranscriptWindow = {}): Promise<TranscriptView> {
  return (await sessionTranscriptPage(cwd, id, null, deps)).view;
}

/** The page from whichever source may answer, or null when none had anything here.
 *
 *  A CURSOR NAMES THE SOURCE THAT MAY ANSWER IT, and no other source is asked (Codex, round 2).
 *  Letting the others answer "their newest page" instead is how a walk whose answering source
 *  changed mid-way — a transcript truncated to nothing, an id two agents both hold — served another
 *  agent's newest turns to a client that had asked for older ones, forever.
 *
 *  Sequential on purpose. Asking every source at once would open a descriptor per agent on a route
 *  polled every 5 seconds per open session, to discard all but one — and the first source answers
 *  for the overwhelming majority of cells. */
async function pageFromCursor(
  cwd: string,
  id: string,
  cursor: { source: string; key: number } | null,
  window: TranscriptWindow,
): Promise<TranscriptPage | null> {
  for (const source of TRANSCRIPT_SOURCES) {
    if (cursor !== null && source.agent !== cursor.source) continue;
    const page = await pageFromSource(source, cwd, id, cursor === null ? null : cursor.key, window);
    if (page !== null) return page;
  }
  return null;
}

/** One page of `id`'s conversation, and the cursor for the page BEFORE it.
 *
 *  `before` is null for the newest page, or a cursor a previous page answered with. This is the one
 *  reader: `sessionTranscriptView` is this with the cursor dropped, so the phone and the browser
 *  share the source list, the budget, the byte cap and the `/clear` rule rather than each holding a
 *  copy that can drift (#2112). */
export async function sessionTranscriptPage(
  cwd: string,
  id: string,
  before: string | null,
  deps: TranscriptViewDeps | TranscriptWindow = {},
): Promise<TranscriptPage> {
  // The old signature took the window positionally and several specs still do. Kept rather than
  // migrated: the window is the only thing those specs vary, and a second parameter shape is
  // cheaper than touching every one of them.
  const {
    window = DEFAULT_TRANSCRIPT_WINDOW,
    agentOf,
    unreadSources = UNREAD_SOURCES,
  } = "tailBytes" in deps ? { window: deps, agentOf: undefined, unreadSources: undefined } : deps;
  if (!cwd || !SESSION_ID_RE.test(id)) return { view: { status: "none" }, older: null };
  // Before any file is opened. A `/clear` or an in-session `/resume` moves claude to another
  // transcript while hooks keep reporting under ours, so `${id}.jsonl` may hold a conversation the
  // cell has left — it still exists, so a stat would happily serve it. transcriptIdOf names the one
  // the cell is in, the same answer the cockpit, the summary and the push read.
  const transcriptId = transcriptIdOf(id);
  if (transcriptId === null) return { view: { status: "cleared" }, older: null };
  // A `before` this host did not mint ends the walk, rather than falling back to the newest page:
  // the route refuses those with a 400, and this reader is not entitled to assume the route ran.
  const cursor = before === null ? null : parseTranscriptCursor(before);
  if (before !== null && cursor === null) return { view: emptyPageView(), older: null };
  const page = await pageFromCursor(cwd, transcriptId, cursor, window);
  if (page !== null) return page;
  // Past a cursor, "no source has anything" is the end of the walk backwards rather than a verdict
  // on the session — the client is holding turns this host just served it.
  if (before !== null) return { view: emptyPageView(), older: null };
  // Nothing on disk for any source. NOW the agent may be asked, and only to choose between two
  // sentences — never to choose a reader. Asking here is safe precisely because it is last: the
  // restarted-claude case (reported as `shell`) has already been answered by claude's file.
  const agent = agentOf?.(id) ?? null;
  if (agent !== null) return { view: agent !== "shell" && !hasReader(agent) ? { status: "not-supported" } : { status: "none" }, older: null };
  // The process is gone, so it cannot say what it was. The stores of the reader-less agents can, and
  // they outlive it (#2116).
  const owner = await unreadOwner(cwd, id, unreadSources);
  return { view: owner === null ? { status: "none" } : { status: "not-supported" }, older: null };
}
