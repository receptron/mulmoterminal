// Whether a file needs reading again, and from where (#3328). The same (size, mtime) rule as
// createAppendFileCache, applied to what the index remembers: an agent's log is only ever appended
// to, so a file that grew is read from where the last scan stopped, and one that shrank or was
// rewritten in place is read again from the start. Pure.
import type { FileStampRead } from "./index-store.js";

export interface RememberedOffset {
  size: number;
  mtimeMs: number;
  scannedTo: number;
}

export type ResumePlan = { kind: "skip" } | { kind: "restart" } | { kind: "resume"; from: number };

export function resumePlan(remembered: RememberedOffset | null, stamp: FileStampRead): ResumePlan {
  if (remembered === null || stamp.size < remembered.size) return { kind: "restart" };
  if (stamp.size === remembered.size && stamp.mtimeMs !== remembered.mtimeMs) return { kind: "restart" };
  // Unchanged, but not read to the end: a pass that stopped between batches, or a last line still
  // being written. Only the tail is read again.
  if (stamp.size === remembered.size) return remembered.scannedTo < stamp.size ? { kind: "resume", from: remembered.scannedTo } : { kind: "skip" };
  if (remembered.scannedTo > stamp.size) return { kind: "restart" };
  return { kind: "resume", from: remembered.scannedTo };
}

/** A resume is only safe on the SAME file. One that grew but no longer starts the way it did was
 *  replaced, and its new bytes do not continue the old ones. */
export const unlessReplaced = (plan: ResumePlan, rememberedHead: string | null, currentHead: string): ResumePlan =>
  plan.kind === "resume" && rememberedHead !== currentHead ? { kind: "restart" } : plan;
