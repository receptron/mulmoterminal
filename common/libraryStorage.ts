// What Claude Code's home takes on disk, for the Library's Storage view (#3333). The server measures
// it on a worker thread and answers in this shape; the browser only shows it.
import { isRecord } from "./isRecord.js";

/** Space taken under one path: bytes on disk, how many files, and how many entries could not be read
 *  (counted, then skipped). */
export interface StorageSize {
  bytes: number;
  files: number;
  unreadable: number;
}

/** One entry directly under Claude Code's home (`projects`, `debug`, `history.jsonl`, …). */
export interface StorageEntry extends StorageSize {
  name: string;
  directory: boolean;
}

/** One project folder under `projects/`, with the directory it is named after when the Library's
 *  index knows it. */
export interface StorageProject extends StorageSize {
  slug: string;
  cwd: string | null;
  temporary: boolean;
}

/** The projects matching a query beyond the ones listed, summed. */
export interface StorageProjectRest extends StorageSize {
  count: number;
}

export interface StorageMeasure {
  /** Epoch ms the measurement finished. */
  measuredAt: number;
  total: StorageSize;
  entries: StorageEntry[];
  /** The largest projects matching the query, largest first. */
  projects: StorageProject[];
  otherProjects: StorageProjectRest;
}

/** Claude Code's `cleanupPeriodDays`: as set, its default when unset, or unreadable settings. */
export type CleanupPeriod = { state: "set" | "default"; days: number } | { state: "unreadable" };

/** Claude Code's default for `cleanupPeriodDays`, from its own settings documentation. */
export const CLEANUP_PERIOD_DEFAULT_DAYS = 30;

export interface StorageProgress {
  done: number;
  of: number;
}

/** GET /api/library/storage. `measure` is the last finished measurement (null before the first);
 *  `measuring` is the one running now, if any; `measureFailed` says the last one ended without an
 *  answer, `measure` then being an older one or null. */
export interface LibraryStorageAnswer {
  root: string;
  measure: StorageMeasure | null;
  measuring: StorageProgress | null;
  measureFailed: boolean;
  cleanup: CleanupPeriod;
}

/** The entry that holds the project folders. */
export const PROJECTS_ENTRY = "projects";

const isSize = (value: Record<string, unknown>): boolean =>
  typeof value.bytes === "number" && typeof value.files === "number" && typeof value.unreadable === "number";

const isEntry = (value: unknown): value is StorageEntry =>
  isRecord(value) && isSize(value) && typeof value.name === "string" && typeof value.directory === "boolean";

const isProject = (value: unknown): value is StorageProject =>
  isRecord(value) &&
  isSize(value) &&
  typeof value.slug === "string" &&
  (value.cwd === null || typeof value.cwd === "string") &&
  typeof value.temporary === "boolean";

const isMeasure = (value: unknown): value is StorageMeasure =>
  isRecord(value) &&
  typeof value.measuredAt === "number" &&
  isRecord(value.total) &&
  isSize(value.total) &&
  Array.isArray(value.entries) &&
  value.entries.every(isEntry) &&
  Array.isArray(value.projects) &&
  value.projects.every(isProject) &&
  isRecord(value.otherProjects) &&
  isSize(value.otherProjects) &&
  typeof value.otherProjects.count === "number";

const isCleanup = (value: unknown): value is CleanupPeriod =>
  isRecord(value) && (value.state === "unreadable" || ((value.state === "set" || value.state === "default") && typeof value.days === "number"));

export const isStorageProgress = (value: unknown): value is StorageProgress =>
  isRecord(value) && typeof value.done === "number" && typeof value.of === "number";

export const isLibraryStorageAnswer = (value: unknown): value is LibraryStorageAnswer =>
  isRecord(value) &&
  typeof value.root === "string" &&
  (value.measure === null || isMeasure(value.measure)) &&
  (value.measuring === null || isStorageProgress(value.measuring)) &&
  typeof value.measureFailed === "boolean" &&
  isCleanup(value.cleanup);
