// The Library's memory (#3331): every project's memory folder, and one memory file. Read only here.
//
// No route takes a path. A folder is named by its project slug and a file by its name, each checked
// against the shape Claude Code gives them, then joined under the agent's own projects root.
import path from "node:path";
import type { Express } from "express";
import { MEMORY_INDEX_FILE } from "../../common/libraryMemory.js";
import { isMemoryFileName, isProjectSlug, listMemoryProjects } from "../backends/library/memory-folders.js";
import { readBoundedText } from "../backends/library/file-history-read.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { answer } from "./library-routes.js";

export function mountMemoryRoutes(app: Express, call: LibraryCaller, projectsRoot: string): void {
  app.get("/api/library/memory", async (_req, res) => {
    const directories = await answer(res, call, "directories", []);
    if (directories === undefined) return;
    const cwds = Array.isArray(directories) ? directories.filter((cwd): cwd is string => typeof cwd === "string") : [];
    try {
      res.json({ projects: await listMemoryProjects(projectsRoot, cwds) });
    } catch {
      res.status(500).json({ error: "the memory folders could not be read" });
    }
  });
  app.get("/api/library/memory/:slug/:file", async (req, res) => {
    const { slug, file } = req.params;
    const named = typeof slug === "string" && typeof file === "string" && isProjectSlug(slug);
    if (!named || !(file === MEMORY_INDEX_FILE || isMemoryFileName(file))) {
      res.status(400).json({ error: "not a memory file" });
      return;
    }
    const read = await readBoundedText(path.join(projectsRoot, slug, "memory", file));
    if (read.reason === "absent") res.status(404).json({ error: "no such memory" });
    else res.json(read);
  });
}
