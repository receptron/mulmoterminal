// Raw file serving — GET /api/files/raw?path=<rel>[&cwd=<session dir>].
//
// Consumers: the collection plugin's image/file fields (the binding's imageSrc maps
// here) and its custom views, whose LLM-authored HTML builds
// `<img src="<origin>/api/files/raw?path=...">` for poster/thumbnail fields; and the
// terminal's clickable file-path links, which pass the session's cwd so a path an agent
// printed inside its own project (possibly a sibling repo outside the workspace root)
// resolves. Mirrors MulmoClaude's server/api/routes/files.ts GET /files/raw (the path the
// gallery view hardcodes), trimmed to what MulmoTerminal needs.
//
// Security (this serves arbitrary files under a base dir):
//   - Base: the workspace root by default, or the `?cwd=` dir when given — but only if
//     that cwd is the root or a live session's directory (`deps.sessionCwds`), never an
//     arbitrary absolute dir from the query. The `path` is then contained within that
//     base — tilde-expanded, then rejected on `..` / absolute / symlink escape.
//   - `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff` so an
//     `.svg`/`.html` with embedded JS can't run in the app origin via direct
//     navigation or <iframe>; PDFs skip the sandbox CSP (WebKit refuses to render
//     sandbox-opaque PDFs) but keep nosniff, and so do audio / video (Chrome's media page
//     cannot fetch the file from the sandbox's opaque origin, so it never plays). The PDF rule
//     matches MulmoClaude's RAW_SECURITY_HEADERS; the media one is ours — see rawServingPlan.
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";
import { sendRawFile } from "./sendRawFile.js";
import { authorizedServingBase, resolveContained } from "../../files/pathContainment.js";
import { rootForProjectId } from "../../infra/fs/project-root.js";

/** Which directory this request may be served from, or the refusal to answer with.
 *
 *  In order: a named PROJECT, then the `?cwd=` dir, then the workspace root.
 *
 *  `?project=` exists because a collection's `image` / `file` fields are relative to ITS root, and
 *  the plugin binding turns them into this URL. Without it a project's records pointed at the
 *  workspace: a missing image at best, another project's file at worst. The id is opaque and
 *  resolved against the server's own list — the same rule as everywhere else, and the reason this
 *  route can accept a project at all without accepting a path.
 *
 *  `?cwd=` is unchanged, for the terminal's clickable paths: honoured only when it is the root or
 *  a live session's directory. */
type ServingBase = { kind: "ok"; dir: string } | { kind: "refused"; status: number; error: string };

function servingBase(req: Request, root: string, sessionCwds: Iterable<string>): ServingBase {
  // PRESENCE is the test, not the shape — the same rule `resolveProjectRoot` applies. Express
  // turns `?project=a&project=b` into an array and `?project[x]=y` into an object, and treating
  // those as "absent" would serve a workspace file to a request that explicitly named a project.
  if (Object.hasOwn(req.query, "project")) {
    const projectId = req.query.project;
    const projectRoot = typeof projectId === "string" ? rootForProjectId(projectId) : null;
    return projectRoot === null ? { kind: "refused", status: 400, error: "unknown project" } : { kind: "ok", dir: projectRoot };
  }
  const cwd = typeof req.query.cwd === "string" ? req.query.cwd : null;
  const dir = authorizedServingBase(cwd, root, sessionCwds);
  return dir === null ? { kind: "refused", status: 403, error: "cwd is not an active session directory" } : { kind: "ok", dir };
}

export function mountFilesRoutes(app: Express, deps: { workspace: string; sessionCwds: () => Iterable<string> }): void {
  const root = path.resolve(deps.workspace);

  app.get("/api/files/raw", (req: Request, res: Response) => {
    const rel = typeof req.query.path === "string" ? req.query.path : "";
    if (!rel) {
      res.status(400).json({ error: "`path` query is required" });
      return;
    }
    // Base, in order: a named PROJECT, then the `?cwd=` dir, then the workspace root.
    //
    // `?project=` exists because a collection's `image` / `file` fields are workspace-relative to
    // ITS root, and the plugin binding turns them into this URL. Without it a project's records
    // pointed at the workspace: a missing image at best, another project's file at worst. The id
    // is opaque and resolved against the server's own list — the same rule as everywhere else,
    // and the reason this route can accept a project at all without accepting a path.
    //
    // `?cwd=` stays as it was for the terminal's clickable paths: honoured only when it is the
    // root or a live session's directory.
    const base = servingBase(req, root, deps.sessionCwds());
    if (base.kind !== "ok") {
      res.status(base.status).json({ error: base.error });
      return;
    }
    // Contain `path` within the base — tilde-expand, reject `..`/absolute escapes
    // lexically, then symlinks. The same gate the browse routes use, so a path one of them
    // serves is never refused by the other.
    const abs = resolveContained(base.dir, rel, os.homedir());
    if (!abs) {
      res.status(403).json({ error: "path escapes the serving root" });
      return;
    }
    sendRawFile(req, res, abs, rel, () => resolveContained(base.dir, rel, os.homedir()));
  });
}
