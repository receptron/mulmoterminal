// Pure decision for whether boot may drop a cleared mark.
//
// Only a transcript CONFIRMED missing counts as absent. A stat that failed for any other reason
// (permissions, an I/O error, an unreadable account home) says nothing about the file, and
// dropping the mark on it would lose the successor for good: the next restart resumes the frozen
// conversation or mints a new session.

import { hasErrnoCode } from "../../errors.js";

export type TranscriptPresence = "present" | "absent" | "unknown";

// ENOTDIR: a component of the path is a file, so nothing can be at the path.
const MISSING_CODES = new Set(["ENOENT", "ENOTDIR"]);

export const presenceOfStatError = (e: unknown): TranscriptPresence => (hasErrnoCode(e) && MISSING_CODES.has(e.code ?? "") ? "absent" : "unknown");

/** `successor` is null when the mark records none. */
export const shouldPruneMark = (own: TranscriptPresence, successor: TranscriptPresence | null): boolean =>
  own === "absent" && (successor === null || successor === "absent");
