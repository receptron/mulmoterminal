// Reading a title out of the front of an agent's own JSONL transcript.
//
// codex rollouts and agy conversations record different things in different shapes, but the
// listing job is the same one twice: read a bounded head (never the whole file — an agent appends
// to these without limit), pick the first line that is a user turn, and turn it into a row title.
import { open } from "node:fs/promises";
import { isRecord } from "../../common/isRecord.js";

const TITLE_MAX = 60;

/** One JSONL line as a record, or null for a truncated final line or a non-JSON row. */
export function parseJsonRecord(line: string): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const doc: unknown = JSON.parse(line);
    return isRecord(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** A prompt as a single-line row title, or `fallback` when there is nothing to show. */
export function cleanTitle(raw: string | null, fallback: string): string {
  const title = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  return title || fallback;
}

/**
 * The first `headBytes` of a transcript, its mtime, and how many BYTES were actually read.
 *
 * Callers want the mtime from the SAME open handle as the head: a file the agent is still
 * appending to can be renamed or removed between a read and a separate stat.
 *
 * `bytesRead` and `fileSize` are reported because `head.length` cannot answer "have we got all of
 * it?" — it counts UTF-16 code units, and multibyte UTF-8 decodes to fewer of those than it
 * occupies in bytes. Deciding EOF from the string is how a long CJK line reads as a short complete
 * one; deciding it from a short read alone misses a file whose size is exactly the window.
 */
export async function readTranscriptHead(
  file: string,
  headBytes: number,
): Promise<{ head: string; mtime: number; bytesRead: number; fileSize: number } | null> {
  let fh;
  try {
    fh = await open(file, "r");
    const buf = Buffer.alloc(headBytes);
    const { bytesRead } = await fh.read(buf, 0, headBytes, 0);
    const { mtimeMs, size: fileSize } = await fh.stat();
    return { head: buf.subarray(0, bytesRead).toString("utf8"), mtime: mtimeMs, bytesRead, fileSize };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/** A transcript's first line, and whether a newline actually ended it. */
export interface FirstLine {
  text: string;
  /** False when the read hit EOF without a newline — the writer may still be mid-record. */
  terminated: boolean;
}

/**
 * The transcript's FIRST line, or null if it cannot be read.
 *
 * Separate from `readTranscriptHead` because the two answer different questions at very different
 * prices. A codex rollout records everything it needs to be ROUTED (its id and cwd) on line 1, but
 * the first thing worth SHOWING sits past 64KB of preamble — so a listing that reads one window
 * for both either pays the large read on every file on disk, or silently gives up on the title.
 *
 * `probeBytes` is a guess at the line length, not a limit: when no newline is found the read grows
 * to `maxBytes` before giving up, so a longer-than-expected first line yields a longer line rather
 * than nothing. Returns null only when the file is unreadable or has no newline within `maxBytes`.
 *
 * The "did we reach EOF" test is `bytesRead >= fileSize`, i.e. we hold the whole file — NOT the
 * decoded length, and not a short read alone. A 60KB first line of Japanese decodes to ~20k UTF-16
 * units, so a length test reads a filled 32KB buffer as a short complete file and hands back a
 * TRUNCATED line; and a file whose size is EXACTLY the window fills the buffer without a short
 * read, so a `bytesRead < size` test calls a complete line absent. Both end the same way: the line
 * parses as nothing and, because the caller memoises, the session leaves the listing for the life
 * of the process (Codex + CodeRabbit on #1782).
 *
 * `terminated` exists for that same caller: an unterminated line is one the agent may still be in
 * the middle of writing, so a caller that remembers answers must not remember THAT one.
 */
export async function readFirstLine(file: string, probeBytes: number, maxBytes: number): Promise<FirstLine | null> {
  for (const size of probeBytes < maxBytes ? [probeBytes, maxBytes] : [maxBytes]) {
    const read = await readTranscriptHead(file, size);
    if (!read) return null;
    const end = read.head.indexOf("\n");
    if (end >= 0) return { text: read.head.slice(0, end), terminated: true };
    if (read.bytesRead >= read.fileSize) return read.head ? { text: read.head, terminated: false } : null;
  }
  return null;
}
