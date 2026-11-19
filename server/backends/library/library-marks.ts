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

/** Removes the lock only if it is still this holder's — by the same move-aside-and-check as a
 *  takeover, so no other holder's lock can be removed between a check and a delete. A holder paused
 *  past the stale time may find its lock taken over; removing it then would let a third process in. */
const release = (lock: string, owner: string): Promise<void> => removeIfOwnedBy(lock, owner);

async function acquire(lock: string, owner: string): Promise<void> {
  for (let attempt = 0; attempt < MARKS_LOCK_ATTEMPTS; attempt += 1) {
    if (await tryAcquire(lock, owner)) return;
    const staleOwner = await staleOwnerOf(lock);
    if (staleOwner !== null) await removeIfOwnedBy(lock, staleOwner, { onlyIfStale: true });
    else await new Promise((resolve) => setTimeout(resolve, MARKS_LOCK_RETRY_MS));
  }
  throw new Error(`${lock} is held by another process`);
}

/** One attempt. The lock is built under a private name with its owner already written, then renamed
 *  into place: a lock therefore never exists without its owner, so no other process can take it over
 *  in between. The rename fails when a lock is already there (it is never empty). */
export async function tryAcquire(lock: string, owner: string): Promise<boolean> {
  const building = `${lock}.${randomUUID()}.new`;
  await fs.mkdir(building);
  await fs.writeFile(ownerFile(building), owner);
  try {
    await fs.rename(building, lock);
    return true;
  } catch (err) {
    await fs.rm(building, { recursive: true, force: true });
    if (err instanceof Error && "code" in err && LOCK_TAKEN.has(String(err.code))) return false;
    throw err;
  }
}

/** What a rename onto an existing lock reports: ENOTEMPTY/EEXIST on POSIX, EPERM on Windows. */
const LOCK_TAKEN = new Set(["ENOTEMPTY", "EEXIST", "EPERM"]);

/** A lock's owner token, or null when it cannot be read — never a value that could match another. */
const ownerOf = (lock: string): Promise<string | null> => fs.readFile(ownerFile(lock), "utf8").catch(() => null);

const isOld = async (lock: string): Promise<boolean> => {
  try {
    return Date.now() - (await fs.stat(lock)).mtimeMs > MARKS_LOCK_STALE_MS;
  } catch {
    return false;
  }
};

/** The owner token of a lock old enough to be taken as abandoned, or null for a live lock. Both are
 *  checked again on the copy actually moved aside (`removeIfOwnedBy`), since the lock at this path
 *  can be replaced between these reads. */
async function staleOwnerOf(lock: string): Promise<string | null> {
  const owner = await ownerOf(lock);
  return owner !== null && (await isOld(lock)) ? owner : null;
}

/** Removes the lock only if `owner` still holds it: moved aside first (atomic), checked, and put back
 *  if it turned out to be someone else's. Used to release one's own lock and to take an abandoned one
 *  out of the way — in both, removing by path could delete a lock another holder has just made. Should
 *  even the put-back lose a race, the holder whose lock moved is refused at its write (`stillHeld`). */
export async function removeIfOwnedBy(lock: string, owner: string, options: { onlyIfStale?: boolean } = {}): Promise<void> {
  const aside = `${lock}.${randomUUID()}.aside`;
  try {
    await fs.rename(lock, aside);
  } catch {
    return; // already gone or replaced: the next attempt sees what is there now
  }
  const moved = await ownerOf(aside);
  // Judged on the copy that was moved: its owner, and — for a takeover — its own age.
  if (moved !== null && moved === owner && (options.onlyIfStale !== true || (await isOld(aside)))) {
    await fs.rm(aside, { recursive: true, force: true });
    return;
  }
  await fs.rename(aside, lock).catch(() => fs.rm(aside, { recursive: true, force: true }));
}
