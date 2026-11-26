// Reading a JSONL transcript without holding it in one string.
//
// A transcript on a working machine reaches 585 MB, and `fs.readFile(file, "utf8")` throws
// "Cannot create a string longer than 0x1fffffe8 characters" past ~512 MB — regardless of what
// the file contains. Every reader that took the whole file caught that and reported "nothing",
// so the longest-running sessions read as the emptiest ones (#998).
//
// Three shapes cover what the callers actually need. Two are not new: this module is where the
// line stream from decision-scan.ts and the tail reader from codex-rollout.ts now live together,
// so a reader picks one instead of writing a third. The third is the byte-range fold a reader uses
// when it will come BACK to the same growing file — reading it whole every time is cheap enough to
// miss until fifty of them are read on every request (#1377).
import { createReadStream, closeSync, openSync, readSync, statSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import readline from "node:readline";
import { isRecord } from "../../../common/isRecord.js";

// How much of the end to read. 256 KB was the codex rollout's window and is nowhere near enough
// for a Claude transcript: one record holds a whole tool_result, so on the 585 MB file here the
// last 256 KB is NINE records — not one complete turn. Measured across the six largest transcripts
// on this machine, 4 MB yields 110-1000 records, which covers a turn with room to spare.
const DEFAULT_TAIL_BYTES = 4 * 1024 * 1024;

/** Every line, in order, without ever materialising the file. `onLine` is called with each line
 *  as it arrives, so the caller decides what to keep — which is the point: a summary keeps a
 *  handful of fields out of hundreds of megabytes. */
export async function forEachJsonlLine(file: string, onLine: (line: string) => void): Promise<void> {
  const input = createReadStream(file, "utf8");
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) onLine(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

/** The FIRST record, without reading past it.
 *
 *  A header line is what several of these files open with — codex writes its `session_meta` there —
 *  and the whole file was being materialised to reach it. That is not a hypothetical cost: codex's
 *  spawn watcher polls every recent rollout once a SECOND for up to thirty minutes, so on this
 *  machine it re-read ~37 MB per pass to look at a few hundred bytes each time (#1553).
 *
 *  The stream is torn down as soon as the line arrives, so the read is one chunk whatever the file
 *  weighs. Null for an empty file, or a first line that is not a JSON object — the same lines
 *  `forEachJsonlRecord` skips.
 */
export async function readFirstJsonlRecord(file: string): Promise<Record<string, unknown> | null> {
  const input = createReadStream(file, "utf8");
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      return jsonlRecord(line);
    }
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

/** Every record in a JSONL file, one at a time — the whole-file counterpart to readTailRecords.
 *  Nothing is kept: `onRecord` decides what survives, which is how a summary distils hundreds of
 *  megabytes into a handful of fields. Malformed and non-object lines are skipped. */
export async function forEachJsonlRecord(file: string, onRecord: (record: Record<string, unknown>) => void): Promise<void> {
  await forEachJsonlLine(file, (line) => {
    if (!line.trim()) return;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) onRecord(parsed);
    } catch {
      // Skip malformed lines, exactly as parseJsonl does.
    }
  });
}

/** Where a scan may start and stop, in BYTES. `to` omitted means EOF.
 *
 *  `atLineStart` is the difference between the two things a byte offset can mean. A resumed scan
 *  continues from an offset a previous scan returned, so the byte IS the start of a line and its
 *  record must be folded. A window picked by arithmetic (the last N bytes) almost always lands
 *  inside a line, and half a line is not JSON — that one is dropped, as readTailLines does. */
export interface JsonlRange {
  from?: number;
  to?: number;
  atLineStart?: boolean;
}

/** What a range fold reads from: a path, or a file the caller already holds open.
 *
 *  A path is re-resolved on every read, so two reads of one path can land on two different files —
 *  and a reader that folds a range and then checks something else about "the file" has no way to
 *  say the two saw the same one. A handle IS the file: it keeps reading what it opened even after
 *  the path is replaced, so everything read through it describes one object (CodeRabbit, #1750). */
export type JsonlSource = string | FileHandle;

/** Fold the records inside a byte range, and answer where the scan stopped. A file that is only ever
 *  appended to can be re-scanned from that offset and the two folds are the same fold — which is
 *  what lets a reader keep a derived value up to date without paying for the whole file again
 *  (#1377).
 *
 *  The last line of a range that runs to EOF has no newline to prove it finished, and it is two
 *  different things: a record the writer wrote without a trailing newline, or half of one it is
 *  still writing. JSON tells them apart — a truncated record does not parse — so a valid one is
 *  folded (matching forEachJsonlRecord, which yields it) and a broken one is left uncounted for the
 *  next scan to pick up whole. At a `to` boundary there is no such question: the cut is arbitrary
 *  and its last line is never folded.
 *
 *  `at` is the offset of the record's OWN line — where it starts, not where it ends. A reader
 *  paging BACKWARDS needs that and nothing else will do: the cursor for the next (older) page is
 *  the first byte of a record already folded, and a range beginning there re-reads that record
 *  whole rather than opening inside it (#2112). */
export async function forEachJsonlRecordIn(
  file: JsonlSource,
  range: JsonlRange,
  onRecord: (record: Record<string, unknown>, at: number) => void,
): Promise<number> {
  const from = range.from ?? 0;
  let offset = from;
  let dropLeading = from > 0 && !(range.atLineStart ?? from === 0);
  await forEachCompleteLine(file, range, (line, bytes, unterminated) => {
    const record = jsonlRecord(line);
    if (unterminated && record === null) return; // half-written: not folded, and not counted
    const at = offset;
    offset += bytes;
    if (dropLeading) {
      dropLeading = false;
      return;
    }
    if (record) onRecord(record, at);
  });
  return offset;
}

// A JSONL line's record, or null for a blank, malformed or non-object line — the same lines
// forEachJsonlRecord skips.
function jsonlRecord(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Split on the newline BYTE rather than decoding the range first: 0x0a cannot appear inside a
// multi-byte UTF-8 sequence, so each complete line decodes on its own and the byte count handed to
// the caller is the file's own, not a character count that would drift from it.
//
// The final line arrives flagged `unterminated` when the range ran to EOF and it had no newline;
// the caller decides what that means.
async function forEachCompleteLine(file: JsonlSource, range: JsonlRange, onLine: (line: string, bytes: number, unterminated: boolean) => void): Promise<void> {
  const from = range.from ?? 0;
  if (range.to !== undefined && range.to <= from) return; // an empty range reads nothing
  // Held across chunks, because a line is split wherever the chunk boundary happens to fall.
  // Copied rather than kept as a view: a subarray pins the whole chunk it came from.
  let carry: Buffer = Buffer.alloc(0);
  for await (const chunk of rangeChunks(file, from, range.to)) {
    const buf: Buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (let nl = buf.indexOf(NEWLINE, start); nl !== -1; nl = buf.indexOf(NEWLINE, start)) {
      onLine(buf.subarray(start, nl).toString("utf8"), nl - start + 1, false);
      start = nl + 1;
    }
    carry = start === 0 ? buf : Buffer.from(buf.subarray(start));
  }
  if (carry.length && range.to === undefined) onLine(carry.toString("utf8"), carry.length, true);
}

/** How much is read per positional read. Only the handle path uses it — a stream picks its own. */
const CHUNK_BYTES = 64 * 1024;

/** The bytes of `[from, to)`, however the source hands them over.
 *
 *  A path streams. A HANDLE is read positionally instead, and that is not a style choice: a stream
 *  built from a FileHandle closes the handle when it is destroyed — `autoClose: false` does not stop
 *  it, measured on node 24 — and the caller opened this handle precisely because it has more to read
 *  from the same file afterwards. Positional reads leave it exactly as they found it, including its
 *  position, so several of them can interleave with the caller's own. */
async function* rangeChunks(file: JsonlSource, from: number, to: number | undefined): AsyncGenerator<Buffer> {
  if (typeof file === "string") {
    const stream = createReadStream(file, { start: from, ...(to === undefined ? {} : { end: to - 1 }) });
    try {
      for await (const chunk of stream) yield asBuffer(chunk);
    } finally {
      stream.destroy();
    }
    return;
  }
  for (let at = from; ;) {
    const want = to === undefined ? CHUNK_BYTES : Math.min(CHUNK_BYTES, to - at);
    if (want <= 0) return;
    const buf = Buffer.alloc(want);
    const { bytesRead } = await file.read(buf, 0, want, at);
    if (bytesRead === 0) return; // EOF
    at += bytesRead;
    yield bytesRead === want ? buf : buf.subarray(0, bytesRead);
  }
}

const NEWLINE = 0x0a;

// A read stream types its chunks as `any`, and this reader's byte accounting is only honest if they
// really are bytes: no encoding is set, so every chunk IS a Buffer, and anything else is a bug
// worth hearing about rather than silently coercing.
function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk);
  throw new TypeError(`jsonl read: expected a Buffer chunk, got ${typeof chunk}`);
}

/** The parsed records at the END of a JSONL file — what every "what happened last" reader wants.
 *  Bounded: it reads `tailBytes`, so a 585 MB transcript costs the same as a 1 KB one. Malformed
 *  lines are skipped, which also covers the partial line a mid-file read can leave behind. */
export function readTailRecords(file: string, tailBytes?: number): Record<string, unknown>[] {
  return recordsOf(readTail(file, tailBytes).lines);
}

/** The same records, and whether they begin at the file's first byte — a reader whose answer
 *  depends on what came before the window has to know when it did not see it. */
export function readTailWindow(file: string, tailBytes?: number): { records: Record<string, unknown>[]; fromFileStart: boolean } {
  const { lines, fromFileStart } = readTail(file, tailBytes);
  return { records: recordsOf(lines), fromFileStart };
}

function recordsOf(lines: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) out.push(parsed);
    } catch {
      // Not JSON — a half line from the read boundary, or a corrupt one. Either way, skip it.
    }
  }
  return out;
}

/** The last lines of a file. The first is dropped when the read started mid-file: that boundary
 *  almost always lands inside a line, and half a line is not JSON. Synchronous and bounded — it
 *  reads `tailBytes`, not the file. Returns [] for anything it cannot read, since every caller
 *  wants "no recent turn" rather than an exception. */
export function readTailLines(file: string, tailBytes: number = DEFAULT_TAIL_BYTES): string[] {
  return readTail(file, tailBytes).lines;
}

function readTail(file: string, tailBytes: number = DEFAULT_TAIL_BYTES): { lines: string[]; fromFileStart: boolean } {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - tailBytes);
    const length = size - start;
    if (length <= 0) return { lines: [], fromFileStart: true };
    const buffer = Buffer.alloc(length);
    fd = openSync(file, "r");
    readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n");
    return { lines: start > 0 ? lines.slice(1) : lines, fromFileStart: start === 0 };
  } catch {
    return { lines: [], fromFileStart: true };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
