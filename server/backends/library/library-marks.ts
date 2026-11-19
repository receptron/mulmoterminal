// Pins and names the user gives conversations in the Library (#3329). Kept in MulmoTerminal's own
// file, never in the agent's transcript, and NOT in the index: the index is a copy that may be deleted
// and rebuilt at any time, and what the user decided must survive that.
import { promises as fs } from "node:fs";
import path from "node:path";
import { emptyLibraryMarks, isLibraryMarks, LIBRARY_NAME_MAX, type LibraryMarkChange, type LibraryMarks } from "../../../common/library.js";
import { MULMOTERMINAL_HOME } from "../../config/env.js";
import { writeFileAtomic } from "../../files/atomic-write.js";
import { createKeySerializer } from "../../infra/async/serialize-per-key.js";

export const LIBRARY_MARKS_FILE = path.join(MULMOTERMINAL_HOME, "library", "marks.json");

/** The marks after one change. Pure: a pin moves to the front, a blank name clears it. */
export function applyMarkChange(marks: LibraryMarks, id: string, change: LibraryMarkChange): LibraryMarks {
  const pinned = change.pinned === undefined ? marks.pinned : [...(change.pinned ? [id] : []), ...marks.pinned.filter((known) => known !== id)];
  if (change.name === undefined) return { pinned, names: marks.names };
  const name = (change.name ?? "").replace(/\s+/g, " ").trim().slice(0, LIBRARY_NAME_MAX);
  const others = Object.fromEntries(Object.entries(marks.names).filter(([known]) => known !== id));
  return { pinned, names: name === "" ? others : { ...others, [id]: name } };
}

/** Absent is empty. Present but unreadable is an error: answering empty would let the next write
 *  replace what the user had with nothing. */
export async function readLibraryMarks(file: string = LIBRARY_MARKS_FILE): Promise<LibraryMarks> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return emptyLibraryMarks();
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isLibraryMarks(parsed)) throw new Error(`${file} is not a marks file`);
  return parsed;
}

const serialize = createKeySerializer();

/** How long a lock may be held before it is taken as left by a process that died holding it. */
export const MARKS_LOCK_STALE_MS = 10_000;
const MARKS_LOCK_RETRY_MS = 25;
const MARKS_LOCK_ATTEMPTS = 200;

/** Read, change, write — one at a time per file within this process, and across processes by a lock
 *  directory beside the file: several servers share one HOME, and each would otherwise read the same
 *  marks and replace the other's change. `mkdir` is the lock because it is atomic everywhere. */
export function changeLibraryMark(id: string, change: LibraryMarkChange, file: string = LIBRARY_MARKS_FILE): Promise<LibraryMarks> {
  return serialize(file, () => withMarksLock(file, () => changeUnlocked(id, change, file)));
}

/** The change itself, holding no lock — exported only for the specs that race two of them. */
export async function changeUnlocked(id: string, change: LibraryMarkChange, file: string): Promise<LibraryMarks> {
  const next = applyMarkChange(await readLibraryMarks(file), id, change);
  await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function withMarksLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await acquire(lock);
  try {
    return await work();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

async function acquire(lock: string): Promise<void> {
  for (let attempt = 0; attempt < MARKS_LOCK_ATTEMPTS; attempt += 1) {
    try {
      await fs.mkdir(lock);
      return;
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
      if (await isStale(lock)) await fs.rm(lock, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, MARKS_LOCK_RETRY_MS));
    }
  }
  throw new Error(`${lock} is held by another process`);
}

async function isStale(lock: string): Promise<boolean> {
  try {
    return Date.now() - (await fs.stat(lock)).mtimeMs > MARKS_LOCK_STALE_MS;
  } catch {
    return false; // released between the two calls: try again
  }
}
