// Deleting one memory from the Library (#3331): the file goes to the machine's Trash and the lines of
// `MEMORY.md` that point at it go with it, as one change — and both come back on Undo.
//
// Undo is remembered here, by an id the client holds; no request names a path. It is kept for a
// while and only while this server runs: after that the file is still in the Trash, put back by hand.
import { randomUUID } from "node:crypto";
import { link, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { MEMORY_INDEX_FILE } from "../../../common/libraryMemory.js";
import { trashEntry, type TrashLayout } from "../../files/tree-ops.js";
import { readBoundedText } from "./file-history-read.js";
import { withEntryBack, withoutEntry, type RemovedIndexLine } from "./memory-index-lines.js";
import { isFaithfulText, memoryVersion, replaceKeepingMode, serialize, type Replace } from "./memory-write.js";

/** How long a delete can be undone from the Library. */
export const MEMORY_UNDO_KEEP_MS = 10 * 60_000;

export type MemoryTrashResult =
  { kind: "trashed"; undo: string } | { kind: "conflict"; version: string | null } | { kind: "refused" } | { kind: "other-volume" };

export type MemoryRestoreResult = "restored" | "taken" | "gone";

interface Undo extends Moved {
  /** The index as it was, and the version this delete left it at: unchanged since, it is put back whole. */
  index: { before: string; written: string; removed: RemovedIndexLine[] } | null;
  at_ms: number;
}

const undos = new Map<string, Undo>();

/** The index's text, null when there is none, or "unreadable": one this cannot rewrite faithfully. */
async function readIndex(index: string): Promise<string | null | "unreadable"> {
  const read = await readBoundedText(index);
  if (read.text === null) return read.reason === "absent" ? null : "unreadable";
  return isFaithfulText(read.text) ? read.text : "unreadable";
}

const modeOf = async (file: string): Promise<number> => (await lstat(file)).mode & 0o777;

const forget = (now_ms: number): void => undos.forEach((undo, id) => now_ms - undo.at_ms > MEMORY_UNDO_KEEP_MS && undos.delete(id));

/** Moves `file` to the Trash when its text is still `expected`, and takes its lines out of the index.
 *  A memory that cannot be kept in step with its index (one this cannot rewrite) is refused. */
export function trashMemory(
  file: string,
  expected: string,
  layout: NonNullable<TrashLayout>,
  now: Date,
  replace: Replace = replaceKeepingMode,
): Promise<MemoryTrashResult> {
  const index = path.join(path.dirname(file), MEMORY_INDEX_FILE);
  return serialize(file, () => serialize(index, () => trashChecked({ file, index, expected, layout, now, replace })));
}

interface TrashRequest {
  file: string;
  index: string;
  expected: string;
  layout: NonNullable<TrashLayout>;
  now: Date;
  replace: Replace;
}

async function trashChecked({ file, index, expected, layout, now, replace }: TrashRequest): Promise<MemoryTrashResult> {
  const current = await readBoundedText(file);
  if (current.text === null) return current.reason === "absent" ? { kind: "conflict", version: null } : { kind: "refused" };
  if (!isFaithfulText(current.text)) return { kind: "refused" };
  if (memoryVersion(current.text) !== expected) return { kind: "conflict", version: memoryVersion(current.text) };
  const before = await readIndex(index);
  if (before === "unreadable") return { kind: "refused" };
  const edit = before === null ? null : withoutEntry(before, path.basename(file));
  // Whatever the identity check after the move says, the file is in the Trash now, so it is undone
  // the same way; only a refusal to cross volumes leaves it where it was.
  const moved = trashEntry(file, layout, now, () => file);
  if (moved.outcome === "other-volume") return { kind: "other-volume" };
  const kept = before !== null && edit !== null && edit.removed.length > 0 ? { before, written: memoryVersion(edit.text), removed: edit.removed } : null;
  if (kept !== null && edit !== null) await rewriteIndexOrPutBack(replace, index, edit.text, { trashed: moved.target, file, info: moved.info });
  forget(now.getTime());
  const id = randomUUID();
  undos.set(id, { file, trashed: moved.target, info: moved.info, index: kept, at_ms: now.getTime() });
  return { kind: "trashed", undo: id };
}

/** The index without the memory's lines; when that write fails, the memory comes back out of the Trash
 *  so the two never disagree. */
async function rewriteIndexOrPutBack(replace: Replace, index: string, text: string, moved: Moved): Promise<void> {
  try {
    await replace(index, text, await modeOf(index));
  } catch (err) {
    await putBack(moved);
    throw err;
  }
}

interface Moved {
  trashed: string;
  file: string;
  info: string | null;
}

/** The trashed file at its own name again, never over a file made there since: a hard link fails on
 *  an existing name, where a rename would replace it. A disk without hard links cannot put it back
 *  here; it stays in the Trash. */
async function putBack({ trashed, file, info }: Moved): Promise<MemoryRestoreResult> {
  try {
    await link(trashed, file);
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : null;
    if (code === "EEXIST") return "taken";
    if (code === "ENOENT" && !(await exists(trashed))) return "gone"; // the Trash was emptied
    throw err;
  }
  await rm(trashed, { force: true });
  if (info !== null) await rm(info, { force: true });
  return "restored";
}

const exists = async (file: string): Promise<boolean> => {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
};

/** Puts a deleted memory back, and its lines into the index: the index as it was when nothing has
 *  changed it since, otherwise the lines at its end. A file made at that name since is not replaced. */
export function restoreMemory(id: string, now: Date): Promise<MemoryRestoreResult> {
  forget(now.getTime());
  const undo = undos.get(id);
  if (undo === undefined) return Promise.resolve("gone");
  const index = path.join(path.dirname(undo.file), MEMORY_INDEX_FILE);
  return serialize(undo.file, () => serialize(index, () => restoreChecked(id, undo, index)));
}

/** A second undo of the same delete, queued behind the first, finds the Trash entry gone. */
async function restoreChecked(id: string, undo: Undo, index: string): Promise<MemoryRestoreResult> {
  const outcome = await putBack(undo);
  if (outcome === "gone") undos.delete(id);
  if (outcome !== "restored") return outcome;
  undos.delete(id);
  if (undo.index !== null) await indexBack(index, path.basename(undo.file), undo.index);
  return "restored";
}

async function indexBack(index: string, file: string, kept: NonNullable<Undo["index"]>): Promise<void> {
  const now = await readIndex(index);
  if (now === null || now === "unreadable") return; // gone or unreadable since: the health check says so
  const next = memoryVersion(now) === kept.written ? kept.before : withEntryBack(now, file, kept.removed);
  if (next !== now) await replaceKeepingMode(index, next, await modeOf(index));
}
