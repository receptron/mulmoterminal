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
  if (stamp.size === remembered.size) return stamp.mtimeMs === remembered.mtimeMs ? { kind: "skip" } : { kind: "restart" };
  if (remembered.scannedTo > stamp.size) return { kind: "restart" };
  return { kind: "resume", from: remembered.scannedTo };
}
