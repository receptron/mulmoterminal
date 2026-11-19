// Pins and names the user gives conversations in the Library (#3329). Kept in MulmoTerminal's own
// file, never in the agent's transcript, and NOT in the index: the index is a copy that may be deleted
// and rebuilt at any time, and what the user decided must survive that.
import { randomUUID } from "node:crypto";
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
  return serialize(file, () => withMarksLock(file, (stillHeld) => changeUnlocked(id, change, file, stillHeld)));
}

/** The change itself — exported for the specs that race two of them. `stillHeld` is asked right
 *  before writing: a holder paused past the stale time, whose lock another has taken, must not write
 *  over that holder's change with what it read before the pause. A narrow window between the check
 *  and the rename remains; a lease without a fencing token cannot close it. */
export async function changeUnlocked(
  id: string,
  change: LibraryMarkChange,
  file: string,
  stillHeld: () => Promise<boolean> = () => Promise.resolve(true),
): Promise<LibraryMarks> {
  const next = applyMarkChange(await readLibraryMarks(file), id, change);
  if (!(await stillHeld())) throw new Error(`${file}: the lock was taken over before this change could be written`);
  await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function withMarksLock<T>(file: string, work: (stillHeld: () => Promise<boolean>) => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const owner = randomUUID();
  await acquire(lock, owner);
  try {
    return await work(async () => (await fs.readFile(ownerFile(lock), "utf8").catch(() => null)) === owner);
  } finally {
    await release(lock, owner);
  }
}

const ownerFile = (lock: string): string => path.join(lock, "owner");

/** Removes the lock only if it is still this holder's. A holder paused past the stale time may find
 *  its lock taken over; removing it then would let a third process in beside the new holder. */
async function release(lock: string, owner: string): Promise<void> {
  const holder = await fs.readFile(ownerFile(lock), "utf8").catch(() => null);
  if (holder === owner) await fs.rm(lock, { recursive: true, force: true });
}

async function acquire(lock: string, owner: string): Promise<void> {
  for (let attempt = 0; attempt < MARKS_LOCK_ATTEMPTS; attempt += 1) {
    try {
      await fs.mkdir(lock);
      await fs.writeFile(ownerFile(lock), owner);
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
