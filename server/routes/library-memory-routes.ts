// The Library's memory (#3331): every project's memory folder, and one memory file. Read only here.
//
// No route takes a path. A folder is named by its project slug and a file by its name, each checked
// against the shape Claude Code gives them, then joined under the agent's own projects root. A
// linked memory FOLDER is followed: Claude Code reads memory through the link too, so this shows
// what the agent loads. A file that is itself a link is not read (readBoundedText).
import path from "node:path";
import type { Express } from "express";
import { MEMORY_EDIT_MAX_BYTES, MEMORY_INDEX_FILE } from "../../common/libraryMemory.js";
import { isMemoryFileName, isProjectSlug, isTheIndex, listMemoryProjects } from "../backends/library/memory-folders.js";
import { readBoundedText } from "../backends/library/file-history-read.js";
import { readMemoryHealth } from "../backends/library/memory-health-read.js";
import { memoryVersion, writeMemory } from "../backends/library/memory-write.js";
import { requestBody } from "./requestBody.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { answer } from "./library-routes.js";

/** The memory file a route names, or null when the slug or the name is not one Claude Code makes. */
function memoryFileOf(projectsRoot: string, slug: unknown, file: unknown): string | null {
  if (typeof slug !== "string" || typeof file !== "string" || !isProjectSlug(slug)) return null;
  if (!(file === MEMORY_INDEX_FILE || isMemoryFileName(file))) return null;
  return path.join(projectsRoot, slug, "memory", file);
}

/** Whether a text read from disk is the file's own bytes: an invalid byte reads as U+FFFD, and writing
 *  that back would change the file without anyone having edited it — so such a file gets no version,
 *  and cannot be edited here. */
export const isFaithfulText = (text: string): boolean => !text.includes("\uFFFD");

/** `{ text, version }` from an edit's body, or null: the whole new text, at most the cap, and the
 *  version of the text the editor was opened on. */
export function memoryEditOf(body: Record<string, unknown>): { text: string; version: string } | null {
  const { text, version } = body;
  if (typeof text !== "string" || typeof version !== "string" || !/^[0-9a-f]{64}$/.test(version)) return null;
  return Buffer.byteLength(text) <= MEMORY_EDIT_MAX_BYTES ? { text, version } : null;
}

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
  app.get("/api/library/memory-health", async (_req, res) => {
    const directories = await answer(res, call, "directories", []);
    if (directories === undefined) return;
    const cwds = Array.isArray(directories) ? directories.filter((cwd): cwd is string => typeof cwd === "string") : [];
    try {
      res.json({ projects: await readMemoryHealth(projectsRoot, cwds) });
    } catch {
      res.status(500).json({ error: "the memory folders could not be read" });
    }
  });
  app.get("/api/library/memory/:slug/:file", async (req, res) => {
    const target = memoryFileOf(projectsRoot, req.params.slug, req.params.file);
    if (target === null) {
      res.status(400).json({ error: "not a memory file" });
      return;
    }
    const read = await readBoundedText(target);
    if (read.reason === "absent") res.status(404).json({ error: "no such memory" });
    else res.json(read.text === null || !isFaithfulText(read.text) ? read : { ...read, version: memoryVersion(read.text) });
  });
  app.put("/api/library/memory/:slug/:file", async (req, res) => {
    // A memory, never the index — by identity, not name: on a case-insensitive disk `memory.md` IS the
    // index. The index is kept in step with the files by the operations that change which files there
    // are, not edited by hand here.
    const named = memoryFileOf(projectsRoot, req.params.slug, req.params.file);
    const target = named !== null && !(await isTheIndex(path.dirname(named), path.basename(named))) ? named : null;
    const edit = memoryEditOf(requestBody(req.body));
    if (target === null || edit === null) {
      res.status(400).json({ error: `expected { text, version } for a memory file, the text at most ${String(MEMORY_EDIT_MAX_BYTES)} bytes` });
      return;
    }
    try {
      const written = await writeMemory(target, edit.text, edit.version);
      if (written.kind === "written") res.json({ version: written.version });
      else if (written.kind === "conflict") res.status(409).json({ error: "the memory changed since it was opened", version: written.version });
      else res.status(400).json({ error: "this memory cannot be edited here" });
    } catch {
      res.status(500).json({ error: "the memory could not be written" }); // the error names the file
    }
  });
}
