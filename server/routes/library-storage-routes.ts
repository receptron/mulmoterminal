// The Library's Storage view over HTTP (#3333). Read-only on Claude Code's home.
//   GET  /api/library/storage?q=   — the last measurement (the largest projects matching q), whether
//                                    one is running and how far it is, and `cleanupPeriodDays`
//   POST /api/library/storage/measure — start a measurement; one already running is joined
// GET only reads: a measurement is started by the POST, so a page elsewhere cannot set one off.
import path from "node:path";
import { open } from "node:fs/promises";
import type { Express } from "express";
import type { CleanupPeriod, LibraryStorageAnswer, StorageMeasure, StorageProject } from "../../common/libraryStorage.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { cleanupPeriodOf } from "../backends/library/cleanup-period.js";
import { createStorageMeasurer, type StorageState } from "../backends/library/storage-measurer.js";
import { listProjects, matchProjects } from "../backends/library/storage-projects.js";
import type { HomeMeasure } from "../backends/library/storage-home.js";
import { temporaryRoots } from "../backends/library/library-index.js";
import { claudeProjectPath, encodeProjectDirName } from "../session/project-dir.js";
import { agentHome } from "../agents/agent-homes.js";

/** Larger than any settings file a person writes; a bigger one is not read whole. */
const SETTINGS_MAX_BYTES = 1024 * 1024;

export interface LibraryStorageDeps {
  /** Claude Code's home; `CLAUDE_CONFIG_DIR` or `~/.claude` otherwise. */
  home?: string;
  measurer?: { measure(): void; state(): StorageState };
}

const isMissing = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "ENOENT";

/** The settings file's text, null when there is none, or undefined when it cannot be read whole within
 *  SETTINGS_MAX_BYTES. Checked and read through one handle, so a file that grows or is swapped in
 *  between cannot be read past the bound. A link is followed, as Claude Code follows it. */
async function readSettingsText(file: string): Promise<string | null | undefined> {
  const handle = await open(file, "r").catch((err: unknown) => (isMissing(err) ? null : undefined));
  if (handle === null || handle === undefined) return handle;
  try {
    if (!(await handle.stat()).isFile()) return undefined;
    const bytes = Buffer.alloc(SETTINGS_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytesRead > SETTINGS_MAX_BYTES ? undefined : bytes.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function readCleanupPeriod(home: string): Promise<CleanupPeriod> {
  const text = await readSettingsText(path.join(home, "settings.json"));
  return text === undefined ? { state: "unreadable" } : cleanupPeriodOf(text);
}

/** The index's directories, or null when it does not answer. */
async function knownDirectories(call: LibraryCaller): Promise<string[] | null> {
  const answer = await call("directories", []).catch(() => null);
  return Array.isArray(answer) ? answer.filter((dir): dir is string => typeof dir === "string") : null;
}

/** Claude Code's own rule for a directory's folder name: the real path, encoded. */
const slugOf = (cwd: string): string => encodeProjectDirName(claudeProjectPath(cwd));

/** A measurement's projects matched to their directories, once per measurement: matching resolves the
 *  real path of every directory the index knows, which is too much to repeat on every read. When the
 *  index does not answer, the sizes are still shown, unmatched, and the next read tries again. */
function projectMatcher(call: LibraryCaller): (measure: HomeMeasure) => Promise<StorageProject[]> {
  let matched: { measuredAt: number; projects: StorageProject[] } | null = null;
  return async (measure) => {
    if (matched?.measuredAt === measure.measuredAt) return matched.projects;
    const directories = await knownDirectories(call);
    const projects = matchProjects(measure.projects, directories ?? [], { slugOf, temporaryRoots: temporaryRoots() });
    if (directories !== null) matched = { measuredAt: measure.measuredAt, projects };
    return projects;
  };
}

function measureFor(measure: HomeMeasure, projects: readonly StorageProject[], query: string): StorageMeasure {
  const listed = listProjects(projects, query);
  return { measuredAt: measure.measuredAt, total: measure.total, entries: measure.entries, projects: listed.projects, otherProjects: listed.rest };
}

export function mountStorageRoutes(app: Express, call: LibraryCaller, deps: LibraryStorageDeps = {}): void {
  const home = deps.home ?? agentHome("claude");
  const measurer = deps.measurer ?? createStorageMeasurer(home);
  const projectsOf = projectMatcher(call);
  app.get("/api/library/storage", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const { measure, measuring, failed } = measurer.state();
    const answer: LibraryStorageAnswer = {
      root: home,
      measure: measure === null ? null : measureFor(measure, await projectsOf(measure), query),
      measuring,
      measureFailed: failed,
      cleanup: await readCleanupPeriod(home),
    };
    res.json(answer);
  });
  app.post("/api/library/storage/measure", (_req, res) => {
    measurer.measure();
    res.status(202).json({ measuring: measurer.state().measuring });
  });
}
