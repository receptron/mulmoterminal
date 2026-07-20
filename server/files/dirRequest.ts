import type { Request, Response } from "express";
import { statSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../session/transcript.js";

// Validate a POST { path } request that names a local directory: same-origin,
// absolute, existing. Returns the directory, or null after sending the matching
// error response — so the caller just does `const dir = resolveDirRequest(...); if (!dir) return;`.
// Shared by the local-only /api/open-dir and /api/git-remote routes.
export function resolveDirRequest(req: Request, res: Response, isAllowedOrigin: (origin?: string) => boolean): string | null {
  if (!isAllowedOrigin(req.headers.origin)) {
    res.status(403).json({ error: "forbidden origin" });
    return null;
  }
  const dir = isRecord(req.body) && typeof req.body.path === "string" ? req.body.path : "";
  if (!dir || !path.isAbsolute(dir)) {
    res.status(400).json({ error: "absolute path required" });
    return null;
  }
  try {
    if (!statSync(dir).isDirectory()) {
      res.status(400).json({ error: "not a directory" });
      return null;
    }
  } catch {
    res.status(404).json({ error: "directory not found" });
    return null;
  }
  return dir;
}
