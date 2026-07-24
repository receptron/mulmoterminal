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
//   - Base: the workspace root by default, or the `?cwd=` session dir (absolute +
//     existing) when given. The `path` is contained within that base — tilde-expanded,
//     then rejected on `..` / absolute / symlink escape (the only real attack surface on
//     a loopback server).
//   - `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff` so an
//     `.svg`/`.html` with embedded JS can't run in the app origin via direct
//     navigation or <iframe>; PDFs skip the sandbox CSP (WebKit refuses to render
//     sandbox-opaque PDFs) but keep nosniff. Matches MulmoClaude's RAW_SECURITY_HEADERS.
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";
import { statFileOr404 } from "./statFileOr404.js";
import { parseByteRange } from "./byte-range.js";
import { rawServingPlan } from "./rawServingPlan.js";
import { streamFileToResponse } from "./streamFile.js";
import { resolveBase, expandTilde, containedPath, realContainedWithin } from "../files/pathContainment.js";

export function mountFilesRoutes(app: Express, deps: { workspace: string }): void {
  const root = path.resolve(deps.workspace);

  app.get("/api/files/raw", (req: Request, res: Response) => {
    const rel = typeof req.query.path === "string" ? req.query.path : "";
    if (!rel) {
      res.status(400).json({ error: "`path` query is required" });
      return;
    }
    // Base: the `?cwd=` session dir when given (else the workspace root). Contain `path`
    // within it — tilde-expand, reject `..`/absolute escapes lexically, then symlinks.
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd : null;
    const base = resolveBase(cwd, root);
    const lexical = containedPath(base, expandTilde(rel, os.homedir()));
    const abs = lexical ? realContainedWithin(base, lexical) : null;
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
