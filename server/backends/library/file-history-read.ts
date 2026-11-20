// Reading what `file-history.ts` folds (#3330): a transcript's file-history records, and the text of
// one kept copy or of the file as it is now — bounded, and never a binary file.
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { boundedLines } from "./bounded-lines.js";
import { LIBRARY_FILE_TEXT_MAX, type LibraryFileText } from "../../../common/libraryFiles.js";
import { createFileHistoryFold, isBackupFileName, type FileHistoryEntry } from "./file-history.js";

/** Only lines that ARE a file-history record are parsed — they begin so — and a turn that merely
 *  mentions one is not. A record is a few kilobytes even for many files; past the limit a line is a
 *  turn, and it is dropped without being gathered. */
const FILE_HISTORY_PREFIX = '{"type":"file-history-';
export const FILE_HISTORY_LINE_MAX = 4 * 1024 * 1024;
const CACHED_TRANSCRIPTS = 8;

/** Folded results by transcript (small: files and their versions), and the reads under way, so a
 *  list and the content requests right after it share one pass over the file. */
const cache = new Map<string, { stamp: string; files: Promise<FileHistoryEntry[]> }>();

async function* fileHistoryRecords(transcript: string): AsyncGenerator<unknown> {
  for await (const line of boundedLines(createReadStream(transcript), FILE_HISTORY_LINE_MAX)) {
    if (!line.startsWith(FILE_HISTORY_PREFIX)) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A line cut off mid-write (the session is still running) is the next read's.
    }
  }
}

async function foldTranscript(transcript: string, cwd: string | null): Promise<FileHistoryEntry[]> {
  const fold = createFileHistoryFold(cwd);
  for await (const record of fileHistoryRecords(transcript)) fold.add(record);
  return fold.result();
}

/** The files a transcript records, read once per change of the file: the list and every content
 *  request after it ask for the same transcript. A failed read is not kept. */
export async function readFileHistory(transcript: string, cwd: string | null = null): Promise<FileHistoryEntry[]> {
  const info = await fs.stat(transcript);
  const key = `${transcript}\u0000${cwd ?? ""}`;
  const stamp = `${String(info.size)}:${String(info.mtimeMs)}`;
  const cached = cache.get(key);
  if (cached?.stamp === stamp) return cached.files;
  const files = foldTranscript(transcript, cwd);
  cache.delete(key);
  cache.set(key, { stamp, files });
  if (cache.size > CACHED_TRANSCRIPTS) cache.delete(cache.keys().next().value ?? "");
  files.catch(() => {
    if (cache.get(key)?.files === files) cache.delete(key);
  });
  return files;
}

const codeOf = (err: unknown): string | null => (err instanceof Error && "code" in err ? String(err.code) : null);

/** At most the cap, read through one handle: the size is checked on the bytes read, not on a stat
 *  that the file can outgrow before the read. */
export async function readBoundedText(file: string): Promise<LibraryFileText> {
  let handle: fs.FileHandle | null = null;
  try {
    // Not through a link: a link placed at a tracked path would show a file the conversation never
    // tracked. And the opened file must be the one looked at, or a swap in between gets through.
    // Linked DIRECTORIES above it are followed on purpose — macOS's /tmp is one, a project folder
    // often is, and the agent edited the file through that same path.
    const seen = await fs.lstat(file);
    if (!seen.isFile()) return { text: null, reason: "unreadable" };
    handle = await fs.open(file, "r");
    const opened = await handle.stat();
    if (opened.dev !== seen.dev || opened.ino !== seen.ino) return { text: null, reason: "unreadable" };
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

/** Whether the session's directory is its own: `<root>/<session>` resolved, not a link to another
 *  session's copies. The root itself may be a link (a moved or shared Claude home). */
async function isOwnSessionDir(fileHistoryRoot: string, sessionId: string): Promise<boolean> {
  try {
    const [root, dir] = await Promise.all([fs.realpath(fileHistoryRoot), fs.realpath(path.join(fileHistoryRoot, sessionId))]);
    return dir === path.join(root, sessionId);
  } catch {
    return false;
  }
}

/** One kept copy, by the name the transcript gave it, in that session's own directory only. Only a
 *  copy with no name means the file did not exist; a named copy that is gone is unreadable — drawn as
 *  "absent" it would show the whole file as created by that turn. */
export async function readKeptCopy(fileHistoryRoot: string, sessionId: string, backupFileName: string | null): Promise<LibraryFileText> {
  if (backupFileName === null) return { text: null, reason: "absent" };
  if (!isBackupFileName(backupFileName) || !(await isOwnSessionDir(fileHistoryRoot, sessionId))) return { text: null, reason: "unreadable" };
  const kept = await readBoundedText(path.join(fileHistoryRoot, sessionId, backupFileName));
  return kept.reason === "absent" ? { text: null, reason: "unreadable" } : kept;
}
