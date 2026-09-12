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
//     sandbox-opaque PDFs) but keep nosniff. Matches MulmoClaude's RAW_SECURITY_HEADERS.
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";
import { statFileOr404 } from "./statFileOr404.js";
import { parseByteRange } from "./byte-range.js";
// Named export: 3.x is ESM and ships its own types. Express uses this same package for
// `res.attachment()`, so the RFC 6266 escaping is the one the rest of the stack already trusts.
import { create as contentDisposition } from "content-disposition";
import { rawServingPlan } from "./rawServingPlan.js";
import { servedFileName } from "./servedFileName.js";
import { streamFileToResponse } from "./streamFile.js";
import { authorizedServingBase, resolveContained } from "../files/pathContainment.js";
import { rootForProjectId } from "../infra/project-root.js";

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
    const stat = statFileOr404(res, abs);
    if (!stat) return;

    const plan = rawServingPlan(abs, stat.size);
    if (plan.tooLarge) {
      res.status(413).json({ error: `file too large (${stat.size} bytes)` });
      return;
    }

    res.setHeader("Content-Type", plan.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // An SVG/HTML with embedded JS must not escape into the app origin; PDFs are the sole
    // exception (WebKit won't render a sandbox-opaque PDF). See rawServingPlan.
    if (plan.sandbox) res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Accept-Ranges", "bytes");
    // The name a save from the browser gets. Without it the browser falls back to the URL's last
    // segment plus an extension guessed from the type, so every file saved as `raw.<ext>` (#2040).
    // BEFORE the Range branch so the 206 carries it too — a media save takes the partial response.
    // `inline`, not `attachment`: this route is how the app RENDERS images, PDFs and text, and
    // `attachment` would turn every one of those into a download.
    const advertised = servedFileName(rel);
    if (advertised !== null) res.setHeader("Content-Disposition", contentDisposition(advertised, { type: "inline" }));

    // Range support (required for <video>/<audio> seeking in Safari).
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, stat.size);
      // A well-formed but unsatisfiable range earns a 416; a malformed / unsupported one is
      // ignored (fall through to the full 200), per RFC 7233 — a 416 breaks a media seek.
      if (range.kind === "unsatisfiable") {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
        res.json({ error: "range not satisfiable" });
        return;
      }
      if (range.kind === "range") {
        res.status(206);
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
        res.setHeader("Content-Length", String(range.end - range.start + 1));
        streamFileToResponse(abs, res, { start: range.start, end: range.end });
        return;
      }
      // range.kind === "ignore" → serve the whole file below.
    }

    res.setHeader("Content-Length", String(stat.size));
    streamFileToResponse(abs, res);
  });
}
