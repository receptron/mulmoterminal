// Folding a transcript's file-history records into the files it changed (#3330). Pure.
//
// Two record types carry the copies. A `file-history-snapshot` at each user message lists every
// tracked file with the copy taken before that turn edited it; a `file-history-delta` adds one copy
// mid-turn — version 1, the file before the conversation first touched it, null when it did not exist.
import path from "node:path";
import { isRecord } from "../../../common/isRecord.js";
import type { LibraryFileVersion, LibraryTrackedFile } from "../../../common/libraryFiles.js";

interface Backup {
  backupFileName: string | null;
  version: number;
  at: number | null;
  realParentDir: string | null;
}

/** A tracked file and where each of its versions is kept. */
export interface FileHistoryEntry {
  trackingPath: string;
  path: string | null;
  /** By version, ascending; the backup name is null for a version where the file did not exist. */
  backups: { version: number; at: number | null; backupFileName: string | null }[];
}

function backupOf(value: unknown): Backup | null {
  if (!isRecord(value) || typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) return null;
  const name = value.backupFileName;
  if (name !== null && typeof name !== "string") return null;
  const at = typeof value.backupTime === "string" ? Date.parse(value.backupTime) : NaN;
  const dir = typeof value.realParentDir === "string" && path.isAbsolute(value.realParentDir) ? value.realParentDir : null;
  return { backupFileName: name, version: value.version, at: Number.isNaN(at) ? null : at, realParentDir: dir };
}

/** The (tracking path, backup) pairs one record carries; none for any other record. */
function backupsIn(record: unknown): [string, Backup][] {
  if (!isRecord(record)) return [];
  if (record.type === "file-history-delta" && typeof record.trackingPath === "string") {
    const backup = backupOf(record.backup);
    return backup === null ? [] : [[record.trackingPath, backup]];
  }
  if (record.type !== "file-history-snapshot" || !isRecord(record.snapshot) || !isRecord(record.snapshot.trackedFileBackups)) return [];
  return Object.entries(record.snapshot.trackedFileBackups).flatMap(([trackingPath, value]): [string, Backup][] => {
    const backup = backupOf(value);
    return backup === null ? [] : [[trackingPath, backup]];
  });
}

/** Where a tracked file is: its own path when absolute, else its name in the directory the record resolved. */
function diskPathOf(trackingPath: string, realParentDir: string | null): string | null {
  if (path.isAbsolute(trackingPath)) return trackingPath;
  return realParentDir === null ? null : path.join(realParentDir, path.basename(trackingPath));
}

/** The files in the order the conversation first touched them, each with its versions once. */
export function foldFileHistory(records: Iterable<unknown>): FileHistoryEntry[] {
  const files = new Map<string, { realParentDir: string | null; versions: Map<number, Backup> }>();
  for (const record of records) {
    for (const [trackingPath, backup] of backupsIn(record)) {
      const file = files.get(trackingPath) ?? { realParentDir: null, versions: new Map<number, Backup>() };
      if (!file.versions.has(backup.version)) file.versions.set(backup.version, backup);
      file.realParentDir = backup.realParentDir ?? file.realParentDir;
      files.set(trackingPath, file);
    }
  }
  return [...files].map(([trackingPath, file]) => ({
    trackingPath,
    path: diskPathOf(trackingPath, file.realParentDir),
    backups: [...file.versions.values()].sort((a, b) => a.version - b.version).map(({ version, at, backupFileName }) => ({ version, at, backupFileName })),
  }));
}

/** What the browser is told about a file: its versions, without where they are kept. */
export const trackedFileOf = (entry: FileHistoryEntry): LibraryTrackedFile => ({
  trackingPath: entry.trackingPath,
  path: entry.path,
  versions: entry.backups.map((backup): LibraryFileVersion => ({ version: backup.version, at: backup.at, exists: backup.backupFileName !== null })),
});

/** A backup's name as Claude Code writes them (`<16 hex>@v<n>`): anything else is not read. */
export const isBackupFileName = (name: string): boolean => /^[0-9a-f]{16}@v[1-9]\d{0,5}$/.test(name);
