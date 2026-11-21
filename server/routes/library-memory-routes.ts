// The Library's memory (#3331): every project's memory folder and one memory file — read, edited,
// moved to the Trash and put back.
//
// No route takes a path. A folder is named by its project slug and a file by its name, each checked
// against the shape Claude Code gives them, then joined under the agent's own projects root. A
// linked memory FOLDER is followed: Claude Code reads memory through the link too, so this shows
// what the agent loads. A file that is itself a link is not read (readBoundedText).
import path from "node:path";
import type { Express, Response } from "express";
import { MEMORY_EDIT_MAX_BYTES, MEMORY_INDEX_FILE } from "../../common/libraryMemory.js";
import { isMemoryFileName, isProjectSlug, isSpeltAsOnDisk, isTheIndex, listMemoryProjects } from "../backends/library/memory-folders.js";
import { readBoundedText } from "../backends/library/file-history-read.js";
import { readMemoryHealth } from "../backends/library/memory-health-read.js";
import { isFaithfulText, memoryVersion, writeMemory } from "../backends/library/memory-write.js";
import { mergeMemory, restoreMemory, trashMemory, type MemoryMergeResult } from "../backends/library/memory-trash.js";
import { systemTrash, type TrashLayout } from "../files/tree-ops.js";
import { requestBody } from "./requestBody.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { answer } from "./library-routes.js";

/** The memory file a route names, or null when the slug or the name is not one Claude Code makes. */
function memoryFileOf(projectsRoot: string, slug: unknown, file: unknown): string | null {
  if (typeof slug !== "string" || typeof file !== "string" || !isProjectSlug(slug)) return null;
  if (!(file === MEMORY_INDEX_FILE || isMemoryFileName(file))) return null;
  return path.join(projectsRoot, slug, "memory", file);
}

/** `{ text, version }` from an edit's body, or null: the whole new text, at most the cap, and the
 *  version of the text the editor was opened on. */
export function memoryEditOf(body: Record<string, unknown>): { text: string; version: string } | null {
  const { text, version } = body;
  if (typeof text !== "string" || typeof version !== "string" || !VERSION.test(version)) return null;
  // Only a text this Library could read back and edit again: no NUL (it would read as binary), no
  // U+FFFD, and nothing UTF-8 cannot hold as given (a lone surrogate is written as U+FFFD).
  if (text.includes("\u0000") || !isFaithfulText(text) || Buffer.from(text, "utf8").toString("utf8") !== text) return null;
  return Buffer.byteLength(text) <= MEMORY_EDIT_MAX_BYTES ? { text, version } : null;
}

const VERSION = /^[0-9a-f]{64}$/;
const UNDO_ID = /^[0-9a-f-]{36}$/;

export function mountMemoryRoutes(app: Express, call: LibraryCaller, projectsRoot: string, trash: () => TrashLayout = systemTrash): void {
  mountMemoryReads(app, call, projectsRoot);
  mountMemorySource(app, call, projectsRoot);
  mountMemoryEdit(app, projectsRoot);
  mountMemoryTrash(app, projectsRoot, trash);
  mountMemoryMerge(app, projectsRoot, trash);
}

/** A memory file a change may act on: one a route names, and never the index — by identity, not name:
 *  on a case-insensitive disk `memory.md` IS the index. The index is kept in step with the files by
 *  the operations that change which files there are, not edited by hand. */
async function changeableMemory(projectsRoot: string, slug: unknown, file: unknown): Promise<string | null> {
  const named = memoryFileOf(projectsRoot, slug, file);
  return named !== null && !(await isTheIndex(path.dirname(named), path.basename(named))) ? named : null;
}

function mountMemoryReads(app: Express, call: LibraryCaller, projectsRoot: string): void {
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
}

function mountMemoryEdit(app: Express, projectsRoot: string): void {
  app.put("/api/library/memory/:slug/:file", async (req, res) => {
    const target = await changeableMemory(projectsRoot, req.params.slug, req.params.file);
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

function mountMemoryTrash(app: Express, projectsRoot: string, trash: () => TrashLayout): void {
  app.post("/api/library/memory/:slug/:file/trash", async (req, res) => {
    const target = await changeableMemory(projectsRoot, req.params.slug, req.params.file);
    const { version } = requestBody(req.body);
    if (target === null || typeof version !== "string" || !VERSION.test(version)) {
      res.status(400).json({ error: "expected { version } for a memory file" });
      return;
    }
    const layout = trash();
    if (layout === null) {
      res.status(501).json({ error: "no Trash on this system" });
      return;
    }
    try {
      if (!(await isSpeltAsOnDisk(path.dirname(target), path.basename(target)))) {
        res.status(409).json({ error: "the memory changed since it was opened", version: null });
        return;
      }
      const trashed = await trashMemory(target, version, layout, new Date());
      if (trashed.kind === "trashed") res.json({ undo: trashed.undo });
      else if (trashed.kind === "conflict") res.status(409).json({ error: "the memory changed since it was opened", version: trashed.version });
      else if (trashed.kind === "other-volume") res.status(400).json({ error: "the memory is on another volume than the Trash, so it was left in place" });
      else res.status(400).json({ error: "this memory cannot be deleted here, as its index could not be kept in step" });
    } catch {
      res.status(500).json({ error: "the memory could not be moved to the Trash" });
    }
  });
  app.post("/api/library/memory-undo", async (req, res) => {
    const { undo } = requestBody(req.body);
    if (typeof undo !== "string" || !UNDO_ID.test(undo)) {
      res.status(400).json({ error: "expected { undo }" });
      return;
    }
    try {
      const restored = await restoreMemory(undo, new Date());
      if (restored === "restored") res.json({ restored: true });
      else if (restored === "taken") res.status(409).json({ error: "a file of that name was made since, so the memory was left in the Trash" });
      else res.status(410).json({ error: "this can no longer be undone here; the memory is in the Trash" });
    } catch {
      res.status(500).json({ error: "the memory could not be put back" });
    }
  });
}

/** Both memories of a merge as the request names them, or null: two different files of one folder,
 *  each named as spelt on disk (a case-insensitive disk would otherwise let one file be both). */
async function mergedPair(projectsRoot: string, slug: unknown, into: unknown, from: unknown): Promise<{ into: string; from: string } | null> {
  const [kept, merged] = await Promise.all([changeableMemory(projectsRoot, slug, into), changeableMemory(projectsRoot, slug, from)]);
  if (kept === null || merged === null || kept === merged) return null;
  const spelt = await Promise.all([kept, merged].map((file) => isSpeltAsOnDisk(path.dirname(file), path.basename(file))));
  return spelt.every(Boolean) ? { into: kept, from: merged } : null;
}

function answerMerge(res: Response, merged: MemoryMergeResult): void {
  if (merged.kind === "merged") res.json({ version: merged.version, undo: merged.undo });
  else if (merged.kind === "conflict") res.status(409).json({ error: "a memory changed since it was opened", file: merged.file });
  else if (merged.kind === "other-volume") res.status(400).json({ error: "the memory is on another volume than the Trash, so nothing was merged" });
  else res.status(400).json({ error: "these memories cannot be merged here, as the index could not be kept in step" });
}

function mountMemoryMerge(app: Express, projectsRoot: string, trash: () => TrashLayout): void {
  app.post("/api/library/memory/:slug/:file/merge", async (req, res) => {
    const body = requestBody(req.body);
    const edit = memoryEditOf(body);
    const pair = await mergedPair(projectsRoot, req.params.slug, req.params.file, body.from);
    if (edit === null || pair === null || typeof body.fromVersion !== "string" || !VERSION.test(body.fromVersion)) {
      res.status(400).json({ error: "expected { text, version, from, fromVersion } for two memory files of one project" });
      return;
    }
    const layout = trash();
    if (layout === null) {
      res.status(501).json({ error: "no Trash on this system" });
      return;
    }
    try {
      const merge = { into: pair.into, text: edit.text, intoVersion: edit.version, from: pair.from, fromVersion: body.fromVersion };
      answerMerge(res, await mergeMemory(merge, layout, new Date()));
    } catch {
      res.status(500).json({ error: "the memories could not be merged" });
    }
  });
}

/** The conversation that last wrote a memory, for the reader to link to. It names no path: the index is
 *  asked by folder and name, checked as every memory route checks them — never the memory index, by
 *  identity as the writes check it (on a case-insensitive disk `memory.md` is that file). */
function mountMemorySource(app: Express, call: LibraryCaller, projectsRoot: string): void {
  app.get("/api/library/memory/:slug/:file/source", async (req, res) => {
    const { slug, file } = req.params;
    if (file === MEMORY_INDEX_FILE || (await changeableMemory(projectsRoot, slug, file)) === null) {
      res.status(400).json({ error: "not a memory file" });
      return;
    }
    const conversation = await answer(res, call, "memorySource", [`${slug}/${file}`]);
    if (conversation !== undefined) res.json({ conversation });
  });
}
