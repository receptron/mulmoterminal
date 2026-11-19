// Reading what `file-history.ts` folds (#3330): a transcript's file-history records, and the text of
// one kept copy or of the file as it is now — bounded, and never a binary file.
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { LIBRARY_FILE_TEXT_MAX, type LibraryFileText } from "../../../common/libraryFiles.js";
import { foldFileHistory, isBackupFileName, type FileHistoryEntry } from "./file-history.js";

/** Only these lines are parsed: a transcript is mostly turns, and parsing every one is the cost. */
const FILE_HISTORY_MARK = '"file-history-';
const CACHED_TRANSCRIPTS = 8;

const cache = new Map<string, { stamp: string; files: FileHistoryEntry[] }>();

async function* fileHistoryRecords(transcript: string): AsyncGenerator<unknown> {
  const lines = createInterface({ input: createReadStream(transcript, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes(FILE_HISTORY_MARK)) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A line cut off mid-write (the session is still running) is the next read's.
    }
  }
}

/** The files a transcript records, read once per change of the file: the list and every content
 *  request after it ask for the same transcript. */
export async function readFileHistory(transcript: string): Promise<FileHistoryEntry[]> {
  const info = await fs.stat(transcript);
  const stamp = `${String(info.size)}:${String(info.mtimeMs)}`;
  const cached = cache.get(transcript);
  if (cached?.stamp === stamp) return cached.files;
  const records: unknown[] = [];
  for await (const record of fileHistoryRecords(transcript)) records.push(record);
  const files = foldFileHistory(records);
  cache.delete(transcript);
  cache.set(transcript, { stamp, files });
  if (cache.size > CACHED_TRANSCRIPTS) cache.delete(cache.keys().next().value ?? "");
  return files;
}

const codeOf = (err: unknown): string | null => (err instanceof Error && "code" in err ? String(err.code) : null);

/** At most the cap, read through one handle: the size is checked on the bytes read, not on a stat
 *  that the file can outgrow before the read. */
export async function readBoundedText(file: string): Promise<LibraryFileText> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(file, "r");
    if (!(await handle.stat()).isFile()) return { text: null, reason: "unreadable" };
    const buffer = Buffer.alloc(LIBRARY_FILE_TEXT_MAX + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > LIBRARY_FILE_TEXT_MAX) return { text: null, reason: "too-large" };
    const bytes = buffer.subarray(0, bytesRead);
    return bytes.includes(0) ? { text: null, reason: "binary" } : { text: bytes.toString("utf8") };
  } catch (err) {
    return { text: null, reason: codeOf(err) === "ENOENT" ? "absent" : "unreadable" };
  } finally {
    await handle?.close();
  }
}

/** One kept copy, by the name the transcript gave it, in that session's own directory only. Only a
 *  copy with no name means the file did not exist; a named copy that is gone is unreadable — drawn as
 *  "absent" it would show the whole file as created by that turn. */
export async function readKeptCopy(fileHistoryRoot: string, sessionId: string, backupFileName: string | null): Promise<LibraryFileText> {
  if (backupFileName === null) return { text: null, reason: "absent" };
  if (!isBackupFileName(backupFileName)) return { text: null, reason: "unreadable" };
  const kept = await readBoundedText(path.join(fileHistoryRoot, sessionId, backupFileName));
  return kept.reason === "absent" ? { text: null, reason: "unreadable" } : kept;
}
