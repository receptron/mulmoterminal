// The files a conversation changed (#3330), as Claude Code's own file history records them: the
// files it edited with its edit tools, and a copy of each as it stood before each turn that edited it.
import { isRecord } from "./isRecord.js";

/** One kept state of a file. `exists` is false where the file was not there yet (the turn created it). */
export interface LibraryFileVersion {
  version: number;
  /** When the copy was taken, ms; null when the record carried no readable time. */
  at: number | null;
  exists: boolean;
}

export interface LibraryTrackedFile {
  /** As the transcript names it: relative to the conversation's directory, or absolute. */
  trackingPath: string;
  /** Where it is on disk, when the record says; null when it cannot be told. */
  path: string | null;
  versions: LibraryFileVersion[];
}

/** One side of a diff. `text` is null when there is nothing to show, and `reason` says why. */
export interface LibraryFileText {
  text: string | null;
  reason?: "absent" | "too-large" | "binary" | "unreadable";
}

/** The biggest file shown, either side: a diff of more is not read, and the server does not send it. */
export const LIBRARY_FILE_TEXT_MAX = 1_000_000;

/** The version that means "the file as it is now", beside the kept numbered ones. */
export const NOW_VERSION = "now";

const isVersion = (value: unknown): value is LibraryFileVersion =>
  isRecord(value) &&
  typeof value.version === "number" &&
  Number.isInteger(value.version) &&
  (value.at === null || typeof value.at === "number") &&
  typeof value.exists === "boolean";

export const isLibraryTrackedFile = (value: unknown): value is LibraryTrackedFile =>
  isRecord(value) &&
  typeof value.trackingPath === "string" &&
  (value.path === null || typeof value.path === "string") &&
  Array.isArray(value.versions) &&
  value.versions.every(isVersion);

const REASONS: readonly string[] = ["absent", "too-large", "binary", "unreadable"];

export const isLibraryFileText = (value: unknown): value is LibraryFileText =>
  isRecord(value) &&
  (value.text === null || typeof value.text === "string") &&
  (value.reason === undefined || (typeof value.reason === "string" && REASONS.includes(value.reason)));
