import type { Request, Response } from "express";
import { statSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { requestOriginAllowed } from "../routes/same-origin-guard.js";

type OriginCheck = (origin: string | undefined, remoteAddress: string | undefined) => boolean;

/** The same gate, for a route that accepts a FILE as well (#2039). `isDir` is what the caller
 *  needs to decide between "open this folder" and "open its folder with this selected". */
export interface ResolvedPath {
  path: string;
  isDir: boolean;
}

// Validate a POST { path } request that names an existing local path: same-origin, absolute,
// existing. Returns it with its kind, or null after sending the matching error response.
//
// NOT contained to the workspace, deliberately and in line with the two routes that came before:
// the server is local, the browser tab cannot touch the filesystem at all, and the threat this
// guards is a random website driving the machine — which is what the same-origin check answers.
// A tree rooted at a session's cwd already shows paths outside the workspace, so containing this
// alone would refuse rows the pane is displaying.
export function resolvePathRequest(req: Request, res: Response, isAllowedOrigin: OriginCheck, notFound = "path not found"): ResolvedPath | null {
  if (!requestOriginAllowed(req, isAllowedOrigin)) {
    res.status(403).json({ error: "forbidden origin" });
    return null;
  }
  const target = isRecord(req.body) && typeof req.body.path === "string" ? req.body.path : "";
  if (!target || !path.isAbsolute(target)) {
    res.status(400).json({ error: "absolute path required" });
    return null;
  }
  try {
    return { path: target, isDir: statSync(target).isDirectory() };
  } catch {
    res.status(404).json({ error: notFound });
    return null;
  }
}

// Validate a POST { path } request that names a local directory: same-origin,
// absolute, existing. Returns the directory, or null after sending the matching
// error response — so the caller just does `const dir = resolveDirRequest(...); if (!dir) return;`.
// Shared by the local-only /api/open-dir and /api/git-remote routes.
export function resolveDirRequest(req: Request, res: Response, isAllowedOrigin: OriginCheck): string | null {
  // The 404 text is this route's own: its callers have always been told "directory", and the
  // widening below must not change a message they may be showing.
  const resolved = resolvePathRequest(req, res, isAllowedOrigin, "directory not found");
  if (!resolved) return null;
  // Kept as its own message: these two routes have always said "directory", and a caller that
  // sent a file gets told which rule it broke rather than a 404 it cannot act on.
  if (!resolved.isDir) {
    res.status(400).json({ error: "not a directory" });
    return null;
  }
  return resolved.path;
}
