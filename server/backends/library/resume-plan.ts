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

/** The two ends of what was read before, and the same two places in the file now. A `tail` of null
 *  means it was not recorded (or not asked for), and only the head is compared. */
export interface ReadEnds {
  head: string;
  tail: string | null;
}

/** A resume is only safe on the SAME file. One that grew but no longer starts the way it did, or no
 *  longer has the bytes it had where the last read stopped, was replaced or rewritten, and its new
 *  bytes do not continue the old ones. */
export function unlessReplaced(plan: ResumePlan, remembered: ReadEnds | null, current: ReadEnds): ResumePlan {
  if (plan.kind !== "resume") return plan;
  if (remembered === null || remembered.head !== current.head) return { kind: "restart" };
  return remembered.tail !== null && remembered.tail !== current.tail ? { kind: "restart" } : plan;
}
