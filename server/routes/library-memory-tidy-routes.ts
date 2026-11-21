// POST /api/library/memory/:slug/tidy — ask for a proposal to tidy one project's memory (#3334): merge
// duplicates, drop what no longer holds, fix what the health check found, move what belongs in a rule
// or a skill. Like Promote, the Library calls no AI itself: it starts a Claude session in plan mode in
// the project's directory, running the bundled skill on that folder, which writes nothing until the
// person approves the plan. Same-origin guarded; the turn is built here from the folder's name alone.
import path from "node:path";
import type { Express } from "express";
import { tidyTurn } from "../../common/libraryPromote.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { requestOriginAllowed } from "./same-origin-guard.js";
import { answer } from "./library-routes.js";
import { isDirectory, startPromoteSession, type LibraryPromoteDeps } from "./library-promote-routes.js";
import { directoriesBySlug } from "../backends/library/memory-health-read.js";

/** The one directory the index knows for folder `slug`, when it is here; null when there is none, or
 *  more than one, which leaves the checkout to start in (and to check the memories against) unknown. */
async function projectDirectory(slug: string, directories: unknown): Promise<string | null> {
  const known = Array.isArray(directories) ? directories.filter((dir): dir is string => typeof dir === "string") : [];
  const dir = directoriesBySlug(known).get(slug);
  return dir !== undefined && (await isDirectory(dir)) ? dir : null;
}

export function mountMemoryTidyRoute(app: Express, call: LibraryCaller, projectsRoot: string, deps: LibraryPromoteDeps): void {
  app.post("/api/library/memory/:slug/tidy", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).end();
    const turn = tidyTurn(req.params.slug);
    if (turn === null) return res.status(400).json({ error: "expected a project folder name" });
    if (!(await isDirectory(path.join(projectsRoot, req.params.slug, "memory")))) return res.status(404).json({ error: "that project has no memory" });
    const directories = await answer(res, call, "directories", []);
    if (directories === undefined) return;
    const cwd = await projectDirectory(req.params.slug, directories);
    if (cwd === null) return res.status(409).json({ error: "the project's directory is not on this machine" });
    await startPromoteSession(res, deps, cwd, turn);
  });
}
