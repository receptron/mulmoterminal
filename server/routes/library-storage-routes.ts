// The Library's Storage view over HTTP (#3333). Read-only on Claude Code's home.
//   GET  /api/library/storage?q=   — the last measurement (the largest projects matching q), whether
//                                    one is running and how far it is, and `cleanupPeriodDays`
//   POST /api/library/storage/measure — start a measurement; one already running is joined
// GET only reads: a measurement is started by the POST, so a page elsewhere cannot set one off.
import path from "node:path";
import { stat, readFile } from "node:fs/promises";
import type { Express } from "express";
import type { CleanupPeriod, LibraryStorageAnswer, StorageMeasure } from "../../common/libraryStorage.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { cleanupPeriodOf } from "../backends/library/cleanup-period.js";
import { createStorageMeasurer, type StorageState } from "../backends/library/storage-measurer.js";
import { listProjects, matchProjects } from "../backends/library/storage-projects.js";
import type { HomeMeasure } from "../backends/library/storage-home.js";
import { temporaryRoots } from "../backends/library/library-index.js";
import { encodeProjectDirName } from "../session/project-dir.js";
import { agentHome } from "../agents/agent-homes.js";

/** Larger than any settings file a person writes; a bigger one is not read whole. */
const SETTINGS_MAX_BYTES = 1024 * 1024;

export interface LibraryStorageDeps {
  /** Claude Code's home; `CLAUDE_CONFIG_DIR` or `~/.claude` otherwise. */
  home?: string;
  measurer?: { measure(): void; state(): StorageState };
}

async function readCleanupPeriod(home: string): Promise<CleanupPeriod> {
  const file = path.join(home, "settings.json");
  try {
    const info = await stat(file);
    if (info.size > SETTINGS_MAX_BYTES) return { state: "unreadable" };
    return cleanupPeriodOf(await readFile(file, "utf8"));
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "ENOENT" ? cleanupPeriodOf(null) : { state: "unreadable" };
  }
}

/** The index's directories, or none when it does not answer: the sizes are still worth showing. */
async function knownDirectories(call: LibraryCaller): Promise<string[]> {
  const answer = await call("directories", []).catch(() => null);
  return Array.isArray(answer) ? answer.filter((dir): dir is string => typeof dir === "string") : [];
}

async function measureFor(measure: HomeMeasure, query: string, call: LibraryCaller): Promise<StorageMeasure> {
  const rules = { slugOf: encodeProjectDirName, temporaryRoots: temporaryRoots() };
  const listed = listProjects(matchProjects(measure.projects, await knownDirectories(call), rules), query);
  return { measuredAt: measure.measuredAt, total: measure.total, entries: measure.entries, projects: listed.projects, otherProjects: listed.rest };
}

export function mountStorageRoutes(app: Express, call: LibraryCaller, deps: LibraryStorageDeps = {}): void {
  const home = deps.home ?? agentHome("claude");
  const measurer = deps.measurer ?? createStorageMeasurer(home);
  app.get("/api/library/storage", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const { measure, measuring } = measurer.state();
    const answer: LibraryStorageAnswer = {
      root: home,
      measure: measure === null ? null : await measureFor(measure, query, call),
      measuring,
      cleanup: await readCleanupPeriod(home),
    };
    res.json(answer);
  });
  app.post("/api/library/storage/measure", (_req, res) => {
    measurer.measure();
    res.status(202).json({ measuring: measurer.state().measuring });
  });
}
