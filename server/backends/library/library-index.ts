// The Library's index as its worker holds it (#3328): an open database, brought up to date in the
// background whenever it is asked for and has not been for a while.
import { mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { LibraryIndexStatus } from "../../../common/library.js";
import { MULMOTERMINAL_HOME } from "../../config/env.js";
import { claudeHistoryFile, claudeProjectsRoot } from "../../session/project-dir.js";
import { prepareLibraryStore, readLease } from "./index-store.js";
import { runIndexPass, type IndexPassDeps } from "./indexer.js";

/** A pass is not started again sooner than this after the last one finished, by any process. */
export const LIBRARY_FRESH_MS = 30_000;

export const LIBRARY_INDEX_FILE = path.join(MULMOTERMINAL_HOME, "library", "index.db");

export interface LibraryIndex {
  db: DatabaseSync;
  /** Starts a pass in the background when one is due; never waits for it. */
  refresh(): void;
  status(): LibraryIndexStatus;
}

export function temporaryRoots(): string[] {
  const tmp = os.tmpdir();
  const roots = [tmp, "/tmp", "/private/tmp", "/var/tmp"];
  try {
    roots.push(realpathSync(tmp)); // macOS hands out /var/…, which is /private/var/… in a recorded cwd
  } catch {
    // An unresolvable temp dir still matches by the name it was given.
  }
  return process.platform === "win32" ? [tmp] : roots;
}

export function createLibraryIndex(db: DatabaseSync, pass: Omit<IndexPassDeps, "db">): LibraryIndex {
  let running: Promise<unknown> | null = null;
  const isDue = (): boolean => {
    const lease = readLease(db);
    if (lease.owner !== null && (lease.expiresMs ?? 0) > pass.now_ms()) return false;
    return lease.finishedMs === null || pass.now_ms() - lease.finishedMs >= LIBRARY_FRESH_MS;
  };
  return {
    db,
    refresh() {
      if (running !== null || !isDue()) return;
      running = runIndexPass({ db, ...pass })
        .catch((err: unknown) => console.warn("[library] index pass failed", String(err)))
        .finally(() => (running = null));
    },
    status() {
      const lease = readLease(db);
      const indexing = running !== null || (lease.owner !== null && (lease.expiresMs ?? 0) > pass.now_ms());
      return { indexing, filesDone: lease.filesDone, filesTotal: lease.filesTotal, finishedAt: lease.finishedMs };
    },
  };
}

export interface LibrarySources {
  projectsRoot: string;
  historyFile: string;
}

export const defaultLibrarySources = (): LibrarySources => ({ projectsRoot: claudeProjectsRoot(), historyFile: claudeHistoryFile() });

/** Attempts at opening, and the wait between them. Switching a NEW file to WAL is refused outright —
 *  without waiting on the busy timeout — while another server is doing the same, so two servers
 *  opening the Library at once need a retry, not a longer timeout. */
const OPEN_ATTEMPTS = 5;
const OPEN_RETRY_MS = 200;

/** Opens (creating if needed) the index file and brings its schema up to date. Throws when it cannot. */
export async function openLibraryIndex(file: string, owner: string, sources: LibrarySources): Promise<LibraryIndex> {
  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt += 1) {
    const db = new DatabaseSync(file);
    try {
      prepareLibraryStore(db);
      return createLibraryIndex(db, { ...sources, temporaryRoots: temporaryRoots(), owner, now_ms: Date.now });
    } catch (err) {
      db.close(); // this handle would only hold the file
      if (attempt >= OPEN_ATTEMPTS) throw err;
      await setTimeout(OPEN_RETRY_MS);
    }
  }
}
