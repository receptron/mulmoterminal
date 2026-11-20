// Deleting one memory from the Library (#3331): the file goes to the machine's Trash and the lines of
// `MEMORY.md` that point at it go with it, as one change — and both come back on Undo.
//
// Undo is remembered here, by an id the client holds; no request names a path. It is kept for a
// while and only while this server runs: after that the file is still in the Trash, put back by hand.
//
// As with a save, another process writing between a check here and the step it guards is the window
// left. For a delete, each step re-reads what it changes, so such a race costs a line, never a memory's
// text. A merge also writes the memory it keeps, and that write — on the merge and on its Undo — has a
// save's own window: a change landing between its check and its rename is written over.
import { randomUUID } from "node:crypto";
import { link, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { MEMORY_INDEX_FILE } from "../../../common/libraryMemory.js";
import { trashEntry, type TrashLayout } from "../../files/tree-ops.js";
import { readBoundedText } from "./file-history-read.js";
import { isSameFile, memoryFileNames } from "./memory-folders.js";
import { withEntryBack, withoutEntry, type RemovedIndexLine } from "./memory-index-lines.js";
import { isFaithfulText, memoryVersion, replaceKeepingMode, serialize, type Replace } from "./memory-write.js";
import { linkPlan, type LinkRewrite } from "./memory-merge-links.js";

/** How long a delete can be undone from the Library. */
export const MEMORY_UNDO_KEEP_MS = 10 * 60_000;

export type MemoryTrashResult =
  { kind: "trashed"; undo: string } | { kind: "conflict"; version: string | null } | { kind: "refused" } | { kind: "other-volume" };

export type MemoryRestoreResult = "restored" | "taken" | "gone";

export type MemoryMergeResult =
  | { kind: "merged"; version: string; undo: string; links: number; text: string }
  | { kind: "conflict"; file: "into" | "from" | "links" }
  | { kind: "refused" }
  | { kind: "other-volume" }
  | { kind: "links-unplaceable"; files: string[] };

/** A memory a merge wrote over: its text before, and the version it was left at. */
interface Written {
  file: string;
  before: string;
  written: string;
}

interface Undo extends Moved {
  /** The index as it was, and the version this delete left it at: unchanged since, it is put back whole. */
  index: { before: string; written: string; removed: RemovedIndexLine[] } | null;
  /** The Trash entry this delete made: the Trash may be emptied and the name taken by another file. */
  entry: { dev: number; ino: number };
  /** A merge's other memory, which took this one's text: put back as it was when nothing has changed it since. */
  merged: { into: string; before: string; written: string } | null;
  /** The other memories a merge pointed this one's links away from: each put back when unchanged since. */
  links: Written[];
  /** The deleted file is back already: a retry after the merged memory could not be put back does only that. */
  fileBack: boolean;
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

/** What a delete or an undo does to the disk, replaceable in specs to make one step fail or race. */
export interface MemoryTrashSteps {
  replace: Replace;
  move: typeof trashEntry;
}
const DISK: MemoryTrashSteps = { replace: replaceKeepingMode, move: trashEntry };

/** Moves `file` to the Trash when its text is still `expected`, and takes its lines out of the index.
 *  A memory that cannot be kept in step with its index (one this cannot rewrite) is refused. */
export function trashMemory(
  file: string,
  expected: string,
  layout: NonNullable<TrashLayout>,
  now: Date,
  steps: MemoryTrashSteps = DISK,
): Promise<MemoryTrashResult> {
  const index = path.join(path.dirname(file), MEMORY_INDEX_FILE);
  return inTurn([file], () => trashChecked({ file, index, expected, layout, now, steps }));
}

interface TrashRequest {
  file: string;
  index: string;
  expected: string;
  layout: NonNullable<TrashLayout>;
  now: Date;
  steps: MemoryTrashSteps;
}

/** The text's version, or null when it is not a faithful text (or not there). */
async function versionOf(file: string): Promise<string | null> {
  const read = await readBoundedText(file);
  return read.text !== null && isFaithfulText(read.text) ? memoryVersion(read.text) : null;
}

async function trashChecked({ file, index, expected, layout, now, steps }: TrashRequest): Promise<MemoryTrashResult> {
  const current = await readBoundedText(file);
  if (current.text === null) return current.reason === "absent" ? { kind: "conflict", version: null } : { kind: "refused" };
  if (!isFaithfulText(current.text)) return { kind: "refused" };
  if (memoryVersion(current.text) !== expected) return { kind: "conflict", version: memoryVersion(current.text) };
  if ((await readIndex(index)) === "unreadable") return { kind: "refused" }; // before moving anything
  const landed = steps.move(file, layout, now, () => file);
  if (landed.outcome === "other-volume") return { kind: "other-volume" };
  const moved: Moved = { trashed: landed.target, file, info: landed.info };
  // The agent may have written the memory between the check and the move, or swapped another file in
  // (the move then reports it escaped): what reached the Trash was at the memory's name an instant
  // ago, and anything but the file and text that were read goes back there.
  if (landed.outcome !== "trashed" || (await versionOf(moved.trashed)) !== expected) {
    await putBack(moved);
    return { kind: "conflict", version: await versionOf(file) };
  }
  const kept = await takeOutOfIndex(steps.replace, index, moved);
  forget(now.getTime());
  const id = randomUUID();
  const { dev, ino } = await lstat(moved.trashed);
  undos.set(id, { ...moved, index: kept, entry: { dev, ino }, merged: null, links: [], fileBack: false, at_ms: now.getTime() });
  return { kind: "trashed", undo: id };
}

/** The index without the memory's lines, edited from its text as it is now, after the move — not as it
 *  was before, which the agent may have changed since. When it cannot be written, the memory comes
 *  back out of the Trash so the two never disagree. */
async function takeOutOfIndex(replace: Replace, index: string, moved: Moved): Promise<Undo["index"]> {
  try {
    const before = await readIndex(index);
    if (before === "unreadable") throw new Error(`${index} became unreadable`);
    // A memory made at that name since the move is what its lines now point at: they stay.
    const edit = before === null || (await exists(moved.file)) ? null : withoutEntry(before, path.basename(moved.file));
    if (before === null || edit === null || edit.removed.length === 0) return null;
    await replace(index, edit.text, await modeOf(index));
    return { before, written: memoryVersion(edit.text), removed: edit.removed };
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
 *  an existing name, where a rename would replace it. The Trash keeps its copy until `dropTrashed`.
 *  A disk without hard links cannot put it back here; it stays in the Trash. */
async function linkBack({ trashed, file }: Moved): Promise<MemoryRestoreResult> {
  try {
    await link(trashed, file);
    return "restored";
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : null;
    if (code === "EEXIST") return "taken";
    if (code === "ENOENT" && !(await exists(trashed))) return "gone"; // the Trash was emptied
    throw err;
  }
}

async function dropTrashed({ trashed, info }: Moved): Promise<void> {
  await rm(trashed, { force: true });
  if (info !== null) await rm(info, { force: true });
}

async function putBack(moved: Moved): Promise<MemoryRestoreResult> {
  const outcome = await linkBack(moved);
  if (outcome === "restored") await dropTrashed(moved);
  return outcome;
}

/** Removes `file` only while it is still the same file as `kept`: one the agent put there since stays. */
async function unlinkIfSame(file: string, kept: string): Promise<void> {
  const [named, original] = await Promise.all([lstat(file).catch(() => null), lstat(kept).catch(() => null)]);
  if (named !== null && original !== null && named.dev === original.dev && named.ino === original.ino) await rm(file, { force: true });
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
export function restoreMemory(id: string, now: Date, replace: Replace = replaceKeepingMode): Promise<MemoryRestoreResult> {
  forget(now.getTime());
  const undo = undos.get(id);
  if (undo === undefined) return Promise.resolve("gone");
  const files = [undo.file, ...(undo.merged === null ? [] : [undo.merged.into]), ...undo.links.map((link) => link.file)];
  return inTurn(files, () => restoreChecked(id, undo, replace));
}

/** Holds the files' turns, in name order, then their folder's index: every change here takes them in
 *  that one order, so two can never each hold what the other waits for. */
function inTurn<T>(files: string[], task: () => Promise<T>): Promise<T> {
  const index = path.join(path.dirname(files[0] ?? ""), MEMORY_INDEX_FILE);
  return [...new Set(files)]
    .sort((x, y) => x.localeCompare(y))
    .reduceRight<() => Promise<T>>(
      (inner, file) => () => serialize(file, inner),
      () => serialize(index, task),
    )();
}

/** The file first, then its lines, then a merged memory. When the lines cannot be written the file
 *  goes out again; when the merged memory cannot, the file stays back. Either way the undo stays, so
 *  it can be tried again. */
async function restoreChecked(id: string, undo: Undo, replace: Replace): Promise<MemoryRestoreResult> {
  if (undos.get(id) !== undo) return "gone"; // an undo queued behind another of the same delete
  if (!undo.fileBack) {
    const outcome = await fileBack(id, undo, replace);
    if (outcome !== "restored") return outcome;
  }
  // Kept until the merged memory is back too: when that write fails, a retry does it again.
  if (undo.merged !== null) await mergedBack(replace, undo.merged);
  // One at a time, as they were written: a failure leaves none still being written behind a retry.
  await undo.links.reduce(async (before, link) => {
    await before;
    await writtenBack(replace, link);
  }, Promise.resolve());
  undos.delete(id);
  return "restored";
}

async function fileBack(id: string, undo: Undo, replace: Replace): Promise<MemoryRestoreResult> {
  const index = path.join(path.dirname(undo.file), MEMORY_INDEX_FILE);
  const entry = await lstat(undo.trashed).catch(() => null);
  const outcome = entry !== null && isSameFile(entry, undo.entry) ? await linkBack(undo) : "gone";
  if (outcome === "gone") undos.delete(id);
  if (outcome !== "restored") return outcome;
  try {
    if (undo.index !== null) await indexBack(replace, index, undo.index);
  } catch (err) {
    await unlinkIfSame(undo.file, undo.trashed); // the link just made; the Trash still holds the file
    throw err;
  }
  await dropTrashed(undo);
  undo.fileBack = true;
  return "restored";
}

/** The memory a merge wrote, as it was before — unless it changed since, when both texts are kept. */
async function mergedBack(replace: Replace, merged: NonNullable<Undo["merged"]>): Promise<void> {
  if ((await versionOf(merged.into)) === merged.written) await replace(merged.into, merged.before, await modeOf(merged.into));
}

/** A memory whose links a merge rewrote, as it was — unless it changed since, when it is kept. */
async function writtenBack(replace: Replace, { file, before, written }: Written): Promise<void> {
  if ((await versionOf(file)) === written) await replace(file, before, await modeOf(file));
}

async function indexBack(replace: Replace, index: string, kept: NonNullable<Undo["index"]>): Promise<void> {
  const now = await readIndex(index);
  if (now === null || now === "unreadable") return; // gone or unreadable since: the health check says so
  const next = memoryVersion(now) === kept.written ? kept.before : withEntryBack(now, kept.removed);
  if (next !== now) await replace(index, next, await modeOf(index));
}

export interface MemoryMerge {
  /** The memory that stays, its new text, and the version it was opened on. */
  into: string;
  text: string;
  intoVersion: string;
  /** The memory merged into it: moved to the Trash, as a delete does, when still at this version. */
  from: string;
  fromVersion: string;
}

/** Writes the merged text over `into` and moves `from` to the Trash with its index lines, as one change
 *  that one Undo reverses: both are checked against the versions they were opened on first. The links
 *  to `from` — in the merged text and in the folder's other memories as listed when it starts — are
 *  pointed at `into`, and each of those memories' turns is held while it does. */
export async function mergeMemory(merge: MemoryMerge, layout: NonNullable<TrashLayout>, now: Date, steps: MemoryTrashSteps = DISK): Promise<MemoryMergeResult> {
  const folder = path.dirname(merge.into);
  // Only these are rewritten: a memory made after this listing has no turn held here, so its links
  // stay as they are (the health check then reports them) rather than being written over unguarded.
  const others = await memoryFileNames(folder);
  return inTurn([merge.into, merge.from, ...others.map((file) => path.join(folder, file))], () => mergeChecked(merge, layout, now, { steps, others }));
}

/** The disk steps, and the folder's memories whose turns the merge holds (all it may rewrite). */
interface MergeHeld {
  steps: MemoryTrashSteps;
  others: readonly string[];
}

async function mergeChecked(merge: MemoryMerge, layout: NonNullable<TrashLayout>, now: Date, { steps, others }: MergeHeld): Promise<MemoryMergeResult> {
  const before = await readBoundedText(merge.into);
  if (before.text === null || !isFaithfulText(before.text) || memoryVersion(before.text) !== merge.intoVersion) return { kind: "conflict", file: "into" };
  const plan = await linkPlan(merge.from, merge.into, merge.text, others);
  if ("kind" in plan) return plan;
  const index = path.join(path.dirname(merge.from), MEMORY_INDEX_FILE);
  const trashed = await trashChecked({ file: merge.from, index, expected: merge.fromVersion, layout, now, steps });
  if (trashed.kind !== "trashed") return trashed.kind === "conflict" ? { kind: "conflict", file: "from" } : trashed;
  const undo = undos.get(trashed.undo);
  if (undo === undefined) throw new Error("the merge's undo was not kept");
  // Checked again after the delete, which takes a while: a change to it meanwhile is not written over.
  if ((await versionOf(merge.into)) !== merge.intoVersion) {
    await restoreChecked(trashed.undo, undo, steps.replace);
    return { kind: "conflict", file: "into" };
  }
  try {
    await steps.replace(merge.into, plan.text, await modeOf(merge.into));
    undo.merged = { into: merge.into, before: before.text, written: memoryVersion(plan.text) };
    await rewriteLinksIn(steps.replace, plan.rewrites, undo, path.dirname(merge.from));
  } catch (err) {
    await restoreChecked(trashed.undo, undo, steps.replace); // everything the merge wrote is put back
    if (err instanceof LinksChanged) return { kind: "conflict", file: "links" };
    throw err;
  }
  return { kind: "merged", version: memoryVersion(plan.text), undo: trashed.undo, links: plan.count, text: plan.text };
}

/** A memory whose links were to be rewritten changed since they were read: another process (the agent)
 *  wrote it, which no turn held here keeps out. */
class LinksChanged extends Error {}

/** The other memories written with their links rewritten, one after another: when one fails, none is
 *  still being written while the merge is put back. Each is read again just before, and one changed
 *  since its links were read stops the merge, rather than its change being written over; the window
 *  left is the save's own, between that read and the rename. Each is recorded before it is written, so
 *  a write that fails leaves its file at the text it had, which putting back leaves alone. */
async function rewriteLinksIn(replace: Replace, rewrites: readonly LinkRewrite[], undo: Undo, folder: string): Promise<void> {
  await rewrites.reduce(async (before, rewrite) => {
    await before;
    const file = path.join(folder, rewrite.file);
    if ((await versionOf(file)) !== memoryVersion(rewrite.before)) throw new LinksChanged(file);
    undo.links.push({ file, before: rewrite.before, written: memoryVersion(rewrite.text) });
    await replace(file, rewrite.text, await modeOf(file));
  }, Promise.resolve());
}
