// The routes behind the tree's file operations (#2578). Each takes the pane's `?cwd=` base and a
// `?path=` under it, like every browse route, and answers with the new path relative to the base.
import path from "node:path";
import type { Express, Request, Response } from "express";
import { requestBody } from "../routes/requestBody.js";
import { createEntry, entryExists, entryUnder, moveToTrash, renameEntry, systemTrash, validEntryName, type EntryKind, type TrashLayout } from "./tree-ops.js";

interface TreeRouteDeps {
  /** The browse base for a raw `?cwd=` value, or null when a cwd was named and is gone (namedBase). */
  base: (cwd: unknown) => string | null;
  /** Where deleted entries go; the machine's own Trash unless a spec gives it another. */
  trash?: () => TrashLayout;
}

const GONE = "the pane's folder is no longer there";
const relPath = (req: Request): string => (typeof req.query.path === "string" ? req.query.path : "");
const isEntryKind = (value: unknown): value is EntryKind => value === "file" || value === "dir";

// What moved was not the entry inside: a folder above it led out by the time it was moved (#3306).
const ESCAPED_DURING = "path escapes the project root";

/** The containment check for `rel` under the request's base, asked again after the operation. */
const entryForRecheck = (req: Request, deps: TreeRouteDeps, rel: string): string | null => {
  const base = deps.base(req.query.cwd);
  return base === null ? null : entryUnder(base, rel);
};

/** The entry the request names, or null with a 403 already sent. */
function entryFor(req: Request, res: Response, deps: TreeRouteDeps): { abs: string } | null {
  const base = deps.base(req.query.cwd);
  if (base === null) {
    res.status(404).json({ error: GONE });
    return null;
  }
  const abs = entryUnder(base, relPath(req));
  if (!abs) {
    res.status(403).json({ error: "path escapes the project root" });
    return null;
  }
  return { abs };
}

/** The entry the request names when it exists, or null with a 403 or 404 already sent. */
function existingEntryFor(req: Request, res: Response, deps: TreeRouteDeps): { abs: string } | null {
  const entry = entryFor(req, res, deps);
  if (!entry) return null;
  if (entryExists(entry.abs)) return entry;
  res.status(404).json({ error: "not found" });
  return null;
}

function mountCreate(app: Express, deps: TreeRouteDeps): void {
  // `path` is the directory the entry goes in ("" for the root); the name is the body's.
  app.post("/api/files/browse/create", (req, res) => {
    const { name, kind } = requestBody(req.body);
    if (!validEntryName(name) || !isEntryKind(kind)) return res.status(400).json({ error: "body.name (a single name) and body.kind (file|dir) required" });
    const base = deps.base(req.query.cwd);
    if (base === null) return res.status(404).json({ error: GONE });
    const dirRel = relPath(req);
    const entryRel = dirRel === "" ? name : `${dirRel}/${name}`;
    const target = entryUnder(base, entryRel);
    if (!target) return res.status(403).json({ error: "path escapes the project root" });
    if (entryExists(target)) return res.status(409).json({ error: "a file or folder with that name already exists" });
    try {
      if (createEntry(target, kind, () => entryUnder(base, entryRel)) === "escaped") return res.status(403).json({ error: "path escapes the project root" });
      res.json({ ok: true, path: entryRel });
    } catch {
      res.status(500).json({ error: "could not create it" });
    }
  });
}

function mountRename(app: Express, deps: TreeRouteDeps): void {
  app.post("/api/files/browse/rename", (req, res) => {
    const { name } = requestBody(req.body);
    if (!validEntryName(name)) return res.status(400).json({ error: "body.name (a single name) required" });
    const entry = existingEntryFor(req, res, deps);
    if (!entry) return;
    const rel = relPath(req);
    const slash = rel.lastIndexOf("/");
    const renamedRel = slash === -1 ? name : `${rel.slice(0, slash)}/${name}`;
    try {
      const outcome = renameEntry(entry.abs, path.join(path.dirname(entry.abs), name), () => entryForRecheck(req, deps, renamedRel));
      if (outcome === "exists") return res.status(409).json({ error: "a file or folder with that name already exists" });
      if (outcome === "escaped") return res.status(403).json({ error: ESCAPED_DURING });
      res.json({ ok: true, path: renamedRel });
    } catch {
      res.status(500).json({ error: "could not rename it" });
    }
  });
}

function mountTrash(app: Express, deps: TreeRouteDeps): void {
  app.get("/api/files/browse/trash", (_req, res) => {
    res.json({ available: (deps.trash ?? systemTrash)() !== null });
  });
  app.post("/api/files/browse/trash", (req, res) => {
    const layout = (deps.trash ?? systemTrash)();
    if (!layout) return res.status(501).json({ error: "no Trash on this system" });
    const entry = existingEntryFor(req, res, deps);
    if (!entry) return;
    try {
      const outcome = moveToTrash(entry.abs, layout, new Date(), () => entryForRecheck(req, deps, relPath(req)));
      if (outcome === "other-volume") return res.status(409).json({ error: "it is on another volume than the Trash, so it was left in place" });
      if (outcome === "escaped") return res.status(403).json({ error: ESCAPED_DURING });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "could not move it to the Trash" });
    }
  });
}

export function mountFilesTreeRoutes(app: Express, deps: TreeRouteDeps): void {
  mountCreate(app, deps);
  mountRename(app, deps);
  mountTrash(app, deps);
}
