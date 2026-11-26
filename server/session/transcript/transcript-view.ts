// Claude's own conversation, folded into the turns the phone reads (#1751).
//
// The phone's terminal view shows ONE pane, and a claude cell runs on the alternate screen with no
// scrollback, so `capture-pane -S -300` returns the pane's 30-41 rows and nothing older. This reads
// the transcript instead, which is the whole conversation the model saw.
//
// Pure on purpose: the window, the truncation rules and the byte cap are decided here, from records
// alone, so every rule is testable without a transcript on disk. The reader that supplies those
// records is transcript-view-read.ts.
//
// Measured on claude 2.1.226 / 2.1.228 / 2.1.231 / 2.1.233. Claude's on-disk format is not a
// published contract, so every rule below leans toward staying VISIBLE when it changes: an unknown
// content block becomes a row saying so rather than nothing, and `thinking` is dropped only because
// its text measured 0 characters in all twelve transcripts sampled — the moment upstream writes a
// body there, it is rendered like any other prose.
import { isRecord } from "../../../common/isRecord.js";
import { describeValue, readString } from "../../../common/readString.js";
import { turnOpeningPrompt, userPromptText } from "./transcript.js";
import { emptyTurnBoundary, type TurnBoundaryState } from "./turn-boundary.js";
import type { TranscriptRow, TranscriptRowKind, TranscriptTurn, TranscriptView } from "../../../common/transcriptView.js";

/** How many LOGICAL lines (newline-separated) the view carries before the oldest turns are dropped.
 *
 *  The goal is ten screens of the phone's terminal view — about 350 displayed rows. The host cannot
 *  know the phone's column count, so it can only count logical lines, and measured over 502 real
 *  turns the logical-to-displayed expansion has a median of 1.39x. 250 logical lines is therefore a
 *  median of 348 displayed ones. */
export const TRANSCRIPT_LINE_BUDGET = 250;

/** How much of one tool result is shown. Its HEAD, because that is the useful end of tool output —
 *  the first lines of a file, the first match of a grep. Without a cap, one turn filled the whole
 *  budget on its own. */
export const TOOL_RESULT_MAX_LINES = 6;

/** The second bound, and it is not the same bound as the line budget: decision 2 does not cap a
 *  `text` block's LINES at all, and one measured record held 4.5 MB (#1692). The reply is written to
 *  a Firestore command doc, which rejects anything over 1 MiB, so a view inside the line budget could
 *  still fail on every poll. Same value as the screen path's SCREEN_MAX_BYTES, for the same reason:
 *  it is a ceiling with room under the real limit, not a budget to spend. */
export const TRANSCRIPT_MAX_BYTES = 256 * 1024;

// What the JSON around each value costs, so the cap bounds the REPLY rather than only the text
// inside it. Each is the widest form of its wrapper, rounded up:
const VIEW_OVERHEAD_BYTES = 64; //  {"status":"ok","turns":[],"truncated":true}
const TURN_OVERHEAD_BYTES = 64; //  {"at":"…","rows":[]},          — `at` is measured separately
const ROW_OVERHEAD_BYTES = 64; //   {"kind":"assistant","text":"","clipped":true},
const CONTENT_BYTE_CAP = TRANSCRIPT_MAX_BYTES - VIEW_OVERHEAD_BYTES;

/** A string's size ON THE WIRE: its JSON encoding, quotes and escapes included.
 *
 *  Not `Buffer.byteLength(text)`, and the difference is not cosmetic. JSON escapes a C0 control byte
 *  to SIX bytes (an ESC becomes the six characters backslash-u-0-0-1-b), and a tool result is
 *  terminal output — the transcripts on this machine are
 *  full of ANSI. Measuring raw bytes let a view sized at 256 KB serialize to 1.5 MB and fail against
 *  Firestore's 1 MiB document limit on every poll, which is the exact failure this cap exists to
 *  prevent (Codex, PR #1776). */
const encodedBytes = (text: string): number => Buffer.byteLength(JSON.stringify(text), "utf8");

// A `text` block belongs to whoever wrote the record. Anything that is neither speaker renders as
// `unknown` rather than being guessed at or dropped — see the note at the top about staying visible.
const SPEAKER_KINDS: Record<string, TranscriptRowKind> = { user: "user", assistant: "assistant" };
const speakerKind = (type: unknown): TranscriptRowKind => SPEAKER_KINDS[readString(type)] ?? "unknown";

const blockTypeName = (part: unknown): string => (isRecord(part) ? readString(part.type) || "?" : "?");

/** A content block no reader here understands, named rather than dropped — the rule at the top of
 *  this file about staying VISIBLE when a format changes.
 *
 *  Exported because every agent's renderer needs the same row: one shape for this, the way
 *  `toolResultRow` is one shape for a result. The TYPE name rather than the block itself, and that
 *  is the bounded choice — a block carries a payload of any size, and this row goes into a view
 *  with a byte cap that would then spend it on a shape nobody can read anyway. */
export const unknownRow = (part: unknown): TranscriptRow => ({ kind: "unknown", text: `[unknown block: ${blockTypeName(part)}]` });

// `Array.isArray` narrows `unknown` to `any[]`, which puts every element read after it outside the
// type checker's reach — the same trap userPromptText documents. The predicate keeps them `unknown`.
const isBlockList = (value: unknown): value is unknown[] => Array.isArray(value);

// Claude's ordinary user records carry `content` as a PLAIN STRING, not an array of blocks — so a
// reader that only understands the array form sees no prose at all in the common case.
const contentBlocks = (content: unknown): unknown[] | null => {
  if (isBlockList(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return null;
};

// An empty string is not prose: a blank row carries nothing a reader can use. (A tool_result is the
// opposite case — see resultText.)
const proseRows = (value: unknown, kind: TranscriptRowKind): TranscriptRow[] => (typeof value === "string" && value !== "" ? [{ kind, text: value }] : []);

// One element of a tool_result's array content. A `text` part contributes its text; anything else is
// rendered by describeValue, so a shape we have not seen is SHOWN rather than silently skipped —
// including the circular case, which it answers for instead of throwing.
const resultPiece = (part: unknown): string[] => {
  if (part === undefined) return []; // there is no rendering of "absent" worth a line
  if (isRecord(part) && typeof part.text === "string") return [part.text];
  return [describeValue(part)];
};

// A tool result as one string, or null when there is nothing to show.
//
// The two empty cases differ. A plain `""` means the tool ran and returned nothing, which IS
// information, so it becomes one empty row. An array that yields no pieces means there was no piece
// to show, so it yields no row at all.
function resultText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!isBlockList(content)) return content === undefined ? null : describeValue(content);
  const joined = content.flatMap(resultPiece).join("\n");
  return joined === "" ? null : joined;
}

/** The first TOOL_RESULT_MAX_LINES of `split("\n")` — a trailing newline's empty element counts, or
 *  a result "capped at 6" would arrive with 7.
 *
 *  Exported because codex's `function_call_output` is the same kind of thing and deserves the same
 *  cap (transcript-view-codex.ts). One tool result should not be shown at six lines for one agent
 *  and whole for another. */
export function toolResultRow(text: string): TranscriptRow {
  const lines = text.split("\n");
  if (lines.length <= TOOL_RESULT_MAX_LINES) return { kind: "tool", text };
  return { kind: "tool", text: lines.slice(0, TOOL_RESULT_MAX_LINES).join("\n"), clipped: true };
}

function renderBlock(part: unknown, speaker: TranscriptRowKind): TranscriptRow[] {
  if (!isRecord(part)) return [unknownRow(part)];
  switch (part.type) {
    case "text":
      return proseRows(part.text, speaker);
    // Measured empty on disk in every transcript sampled, so today this renders nothing. Rendered
    // like prose rather than discarded by name, so the day upstream writes a body it appears.
    case "thinking":
      return proseRows(part.thinking, speaker);
    case "tool_use": {
      // The name only — arguments are what make a tool call long, and the result below says what it
      // did. A tool_use with no usable name is a shape change, so it says so.
      const name = readString(part.name).trim();
      return name ? [{ kind: "tool", text: name, call: true }] : [unknownRow(part)];
    }
    case "tool_result": {
      const text = resultText(part.content);
      return text === null ? [] : [toolResultRow(text)];
    }
    default:
      return [unknownRow(part)];
  }
}

/** One record's rows, in the order its content blocks appear — never merged, never reordered, since
 *  the order is what makes "it said this, then ran that" readable. A record with no message or no
 *  usable content contributes nothing. */
export function renderRecord(record: Record<string, unknown>): TranscriptRow[] {
  const message = isRecord(record.message) ? record.message : null;
  const blocks = message ? contentBlocks(message.content) : null;
  if (!blocks) return [];
  const speaker = speakerKind(record.type);
  return blocks.flatMap((part) => renderBlock(part, speaker));
}

/** Where a turn starts: a non-sidechain `user` record whose content holds a real prompt.
 *
 *  `userPromptText` rather than a fresh predicate, because it already handles BOTH content shapes —
 *  and claude's ordinary prompts are the plain-string one. A predicate written as "has a text block"
 *  would miss them, fusing every exchange into one turn that the line budget can never evict.
 *
 *  Text written into a turn already open (a skill's body, an image note) does not open another: the
 *  `promptId` rule in turn-boundary.ts, which falls back to the text alone for a record without one.
 *
 *  Returns the PROMPT rather than a boolean, because the fold needs the text as well: a record can
 *  satisfy this predicate and render no rows (`userPromptText` reads `.text` off any block, while the
 *  render rules read it only off a `text` one), and a turn that opens empty is a blank block on the
 *  phone that no budget can evict. One function answering both keeps the two from disagreeing. */
export function turnBoundaryPrompt(record: Record<string, unknown>, boundary: TurnBoundaryState = emptyTurnBoundary()): string | null {
  if (record.isSidechain === true) return null;
  return turnOpeningPrompt(boundary, record);
}

export const isTurnBoundary = (record: Record<string, unknown>): boolean => turnBoundaryPrompt(record) !== null;

/** Claude Code's own UI does not show a meta record — and one that opens no turn is a skill's body or
 *  an image note, which shown here reads as something the user said. */
const isHiddenMeta = (record: Record<string, unknown>, prompt: string | null): boolean =>
  record.isMeta === true && prompt === null && userPromptText(isRecord(record.message) ? record.message.content : undefined) !== null;

/** How much of `timestamp` is carried as a turn's `at`. An ISO-8601 instant is 24 characters, 29
 *  with an offset; past 64 bytes it is not a timestamp, and this field is read by a machine — so an
 *  over-long one becomes null ("unknown") rather than being cut, which would silently name a
 *  DIFFERENT time. Bounded at all because `at` is passed through from disk and would otherwise be an
 *  unbounded string inside a capped reply (Codex, PR #1776). */
const TURN_AT_MAX_BYTES = 64;

const rawTurnAt = (record: Record<string, unknown>): string | null => (typeof record.timestamp === "string" ? record.timestamp : null);

/** The bound applied to whatever the agent's reader found. In `foldTurnRecord` rather than in each
 *  agent's renderer, so a second agent cannot forget it. */
const boundedTurnAt = (at: string | null): string | null => (at !== null && encodedBytes(at) <= TURN_AT_MAX_BYTES ? at : null);

/** The fold's state: the turns kept so far, oldest first. */
export interface TranscriptScan {
  turns: TranscriptTurn[];
  /** Logical lines across `turns` — see countedLines for why this is not `rows.length`. */
  lines: number;
  /** Something was left out: a turn evicted by the budget, or a fragment before the first turn. */
  truncated: boolean;
}

export const emptyTranscriptScan = (): TranscriptScan => ({ turns: [], lines: 0, truncated: false });

// The budget counts LINES, not row objects. A `text` block is passed through whole, so counting one
// row as one line would let a single 900-line answer walk straight past a 250-line budget.
const countedLines = (rows: readonly TranscriptRow[]): number => rows.reduce((n, row) => n + row.text.split("\n").length, 0);

/** One record, as the AGENT-NEUTRAL half of the fold sees it: does it open a turn, when did that
 *  turn start, and what does it render.
 *
 *  This shape is the whole of what a second agent has to supply (#1822). Everything below it — the
 *  turn boundary's meaning, the empty-turn guard, the pre-boundary fragment rule, the line budget
 *  and the eviction order — is the phone's view and is deliberately NOT re-decided per agent. */
export interface TurnRecord {
  /** The prompt that opens a turn here, or null when this record does not open one. */
  prompt: string | null;
  /** The opening record's own timestamp, passed through. Bounded here, not by the caller. */
  at: string | null;
  /** What this record renders, in order. */
  rows: readonly TranscriptRow[];
}

/** Fold one already-rendered record into the scan. Same shape as session-reads.ts's `foldTimeline`;
 *  only the window differs, being lines and whole turns rather than a count of events. */
export function foldTurnRecord(scan: TranscriptScan, record: TurnRecord): void {
  const { prompt, rows: rendered } = record;
  if (prompt !== null) {
    scan.turns.push({ at: boundedTurnAt(record.at), rows: [] });
  } else if (scan.turns.length === 0) {
    // The window opens mid-turn, so it starts with the tail of one whose prompt is outside it.
    // Dropped rather than shown as a synthetic turn: a fragment with no speaker leads the view, and
    // counting it against the budget would let something un-evictable push the newest turn out.
    //
    // Marked truncated only when the fragment had something to SHOW. Measured on this machine, most
    // transcripts open with `queue-operation` / `attachment` records that render nothing at all, so
    // marking every pre-boundary record would tell the phone "there is more before this" on a
    // complete conversation — and the same records mid-file cost nothing, so it would be a mark for
    // where a record sits rather than for anything missing.
    if (rendered.length > 0) scan.truncated = true;
    return;
  }
  const turn = scan.turns[scan.turns.length - 1];
  if (!turn) return;
  // A boundary is a boundary BECAUSE it carries a prompt, so the turn it opens is never empty: where
  // the block rules render nothing from it, the text the predicate found IS the row. Without this a
  // turn can arrive with no rows — invisible on the phone, and costing 0 lines, so the budget that
  // evicts by lines can never reclaim it.
  const rows = rendered.length > 0 || prompt === null ? rendered : [{ kind: "user" as const, text: prompt }];
  turn.rows.push(...rows);
  scan.lines += countedLines(rows);
  evictOldestTurns(scan);
}

/** Fold one of CLAUDE's records into the scan. `boundary` lives as long as the scan does. */
export function foldTranscriptView(scan: TranscriptScan, record: Record<string, unknown>, boundary: TurnBoundaryState): void {
  // A sub-agent's record is dropped whole — not merely disqualified as a boundary. Filtering it in
  // the boundary predicate alone would still let its assistant records land as rows of whichever
  // turn happened to be open, attributing a sub-agent's work to the main conversation.
  if (record.isSidechain === true) return;
  const prompt = turnBoundaryPrompt(record, boundary);
  foldTurnRecord(scan, { prompt, at: rawTurnAt(record), rows: isHiddenMeta(record, prompt) ? [] : renderRecord(record) });
}

// Whole turns, oldest first — half a turn is not readable. Never the last one: decision 1 is that
// the newest turn is shown however big it is.
function evictOldestTurns(scan: TranscriptScan): void {
  while (scan.lines > TRANSCRIPT_LINE_BUDGET && scan.turns.length > 1) {
    const dropped = scan.turns.shift();
    if (!dropped) return;
    scan.lines -= countedLines(dropped.rows);
    scan.truncated = true;
  }
}

/** Folds records into a scan while remembering, for each turn the scan still holds, the cursor key
 *  of the record that OPENED it — a byte offset for an agent that keeps a file, copilot's
 *  `turn_index` for the one that keeps a table (#2112).
 *
 *  A backwards pager needs the key of the OLDEST turn it kept, and the window's own start does NOT
 *  answer it: the budget evicts from the front, so the turns between the window start and the oldest
 *  kept one have been dropped, and a cursor at the window start would page straight past them —
 *  a gap in the middle of a conversation, with nothing anywhere saying so.
 *
 *  WHETHER A RECORD OPENED A TURN IS ASKED BY IDENTITY, NOT BY COUNTING. One record can open a turn
 *  AND push the budget over, evicting another in the same fold, which leaves `turns.length`
 *  unchanged over a record that did open one. Eviction only ever shifts from the FRONT, so "the last
 *  element is a different object" is exactly "a turn was pushed", whatever happened at the other end.
 *
 *  Generic over the record, because the two kinds of source hand their folds different things and
 *  the bookkeeping is the same for both — a second copy of it is a second place for the gap above to
 *  come back. */
export interface TurnStartTracker<R> {
  /** Fold one record, keyed by where it came from. */
  fold: (record: R, key: number) => void;
  /** The keys, parallel to `scan.turns` — oldest first.
   *
   *  The ARRAY rather than "the oldest one", because the scan is not the last word on what a reader
   *  sees: `transcriptViewOf` applies the byte cap and drops further turns from the front. The
   *  cursor has to name the oldest turn SHOWN, so whoever knows how many survived does the indexing.
   *  Measured on a real 8.9 MB transcript, taking the scan's oldest lost 8 of its 31 turns — and the
   *  walk still ended tidily at the head, which is what makes that failure invisible. */
  keys: () => readonly number[];
}

export function trackTurnStarts<R>(scan: TranscriptScan, fold: (record: R) => void): TurnStartTracker<R> {
  const keys: number[] = [];
  return {
    fold: (record, key) => {
      const lastBefore = scan.turns[scan.turns.length - 1];
      fold(record);
      const lastAfter = scan.turns[scan.turns.length - 1];
      if (lastAfter !== undefined && lastAfter !== lastBefore) keys.push(key);
      // Evictions that happened inside the fold, paid back here so the two arrays stay parallel.
      while (keys.length > scan.turns.length) keys.shift();
    },
    keys: () => keys,
  };
}

const rowBytes = (row: TranscriptRow): number => encodedBytes(row.text) + ROW_OVERHEAD_BYTES;

// `at` is measured rather than folded into the constant: it is claude's `timestamp` field passed
// through, so a corrupt transcript can put an arbitrarily long string there.
const turnBytes = (turn: TranscriptTurn): number => turn.rows.reduce((n, row) => n + rowBytes(row), TURN_OVERHEAD_BYTES + encodedBytes(turn.at ?? ""));

// The start of the character containing byte `at` — a continuation byte is 0b10xxxxxx, so walking
// back off them lands on a character boundary and the cut never splits a sequence.
function charStart(buf: Buffer, at: number): number {
  let start = at;
  while (start > 0 && ((buf[start] ?? 0) & 0xc0) === 0x80) start--;
  return start;
}

// The start of the character AFTER the one containing `at` — the end of the buffer when there is
// none. Always strictly greater than `at`, which is what keeps the search below moving.
function nextCharStart(buf: Buffer, at: number): number {
  let next = at + 1;
  while (next < buf.length && ((buf[next] ?? 0) & 0xc0) === 0x80) next++;
  return next;
}

/** The longest prefix of `text` whose JSON ENCODING fits in `maxBytes`.
 *
 *  Encoded, not raw — see encodedBytes for why the two differ by up to six times. There is no cheap
 *  arithmetic from one to the other, so this searches: encoded length grows monotonically with the
 *  prefix, which is exactly what a binary search needs. Every candidate is cut on a character
 *  boundary, so the answer is valid UTF-8 whichever one wins.
 *
 *  It runs only when a single turn is over the cap on its own, which is the pathological case the
 *  4.5 MB record of #1692 makes real. */
export function clipToEncodedBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (encodedBytes(text) <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8");
  let fits = 0; // a prefix length that is known to fit
  let over = buf.length; // and one that is known not to
  while (fits < over) {
    // The midpoint, snapped FORWARD past the character `fits` is inside of. Snapping only backwards
    // collapses onto `fits` whenever the remaining span is shorter than the character sitting at it
    // — with a four-byte character and five bytes left, the midpoint is byte 2, walks back to 0, and
    // the search gives up on a prefix that fits (Codex, PR #1776). Forward, every step is a real
    // boundary strictly past `fits`, so the interval always shrinks.
    const mid = Math.max(charStart(buf, (fits + over) >> 1), nextCharStart(buf, fits));
    if (mid >= over) break; // no boundary strictly between the two — `fits` is the longest that fits
    if (encodedBytes(buf.subarray(0, mid).toString("utf8")) <= maxBytes) fits = mid;
    else over = mid;
  }
  return buf.subarray(0, fits).toString("utf8");
}

// The newest turn does not fit even alone. It is the one turn that must survive (decision 1), so its
// ROWS pay instead: spent from the start, because a turn opens with the prompt that asked for it and
// nothing after that reads without it. The row the budget runs out inside is cut and marked rather
// than removed, so the view shows where it stops.
function clipTurn(turn: TranscriptTurn): TranscriptTurn {
  const rows: TranscriptRow[] = [];
  let remaining = CONTENT_BYTE_CAP - TURN_OVERHEAD_BYTES - encodedBytes(turn.at ?? "");
  turn.rows.forEach((row) => {
    if (remaining <= 0) return;
    const size = rowBytes(row);
    if (size <= remaining) {
      rows.push(row);
      remaining -= size;
      return;
    }
    rows.push({ ...row, text: clipToEncodedBytes(row.text, remaining - ROW_OVERHEAD_BYTES), clipped: true });
    remaining = 0;
  });
  return { ...turn, rows };
}

// The newest turns that fit, stopped at the first that does not — the same rule the screen path's
// withinByteCap uses, and for the same reason: skipping an oversized turn to keep older ones would
// hand the phone a conversation with a hole in it.
function withinByteCap(turns: readonly TranscriptTurn[]): { turns: TranscriptTurn[]; truncated: boolean } {
  const fit = turns.reduceRight<{ kept: TranscriptTurn[]; bytes: number; full: boolean }>(
    (state, turn) => {
      if (state.full) return state;
      const bytes = state.bytes + turnBytes(turn);
      if (bytes > CONTENT_BYTE_CAP) return { ...state, full: true };
      return { kept: [turn, ...state.kept], bytes, full: false };
    },
    { kept: [], bytes: 0, full: false },
  );
  if (fit.kept.length > 0) return { turns: fit.kept, truncated: fit.full };
  const newest = turns[turns.length - 1];
  return newest ? { turns: [clipTurn(newest)], truncated: true } : { turns: [], truncated: false };
}

/** The scan as the wire shape.
 *
 *  `windowStartedMidFile` is the third way a view can be incomplete, and the only one the fold
 *  cannot see: a tail read that begins after byte 0 has already dropped every older turn before the
 *  line budget could fire, so without it a cut history would arrive claiming to be the whole one. */
export function transcriptViewOf(scan: TranscriptScan, windowStartedMidFile: boolean): TranscriptView {
  if (scan.turns.length === 0) return { status: "none" };
  const fitted = withinByteCap(scan.turns);
  return { status: "ok", turns: fitted.turns, truncated: scan.truncated || fitted.truncated || windowStartedMidFile };
}
