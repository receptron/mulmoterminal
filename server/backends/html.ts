// Host wiring for @mulmoclaude/html-plugin (presentHtml). The tool-call path
// (executeHtml: save new HTML / present an existing path) is handled by the generic
// package loader (plugins.json `packages` → /api/plugin/presentHtml via the FileOps
// context). This module adds the two host-specific pieces:
//
//   1. The View's source-editor DISPATCH — `useRuntime().dispatch({kind})` POSTs to
//      the same /api/plugin/presentHtml route, but with `kind: "loadHtml"|"saveHtml"`,
//      which executeHtml doesn't handle. We intercept those before the generic
//      catch-all and route them to executeHtmlDispatch (read/write via the artifacts
//      FileOps); a tool-call (no `kind`) falls through to the package execute. After a
//      save we publish a file-change so any open View live-refreshes.
//   2. Serving the page for the iframe — the View renders `<iframe src=
//      "/artifacts/html/…">` (htmlArtifactPreviewUrl). We serve that path from the
//      workspace with an HTML preview CSP (sandboxed-ish: inline scripts + a curated
//      CDN allowlist, but connect-src 'none' so a page can't phone home). A page the
//      tool was POINTED at rather than wrote lives anywhere on disk, so it is served
//      from a second, uncontained mount — `/htmlfile` (mountHtmlFileRoute below).
import path from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import { executeHtmlDispatch, HTML_FILE_MOUNT } from "@mulmoclaude/html-plugin";
import { artifactsFileOps } from "./artifacts.js";
import { htmlByPath, resolveHtmlRequest } from "./openPath.js";
import { publishFileChange } from "./fileChange.js";
import { statFileOr404 } from "./statFileOr404.js";
import { streamFileToResponse } from "./streamFile.js";
import { isWithin } from "../infra/path-within.js";

// Curated CDN allowlist (matches the collection custom-view policy) for an
// LLM-authored page that may pull a charting/util lib or font from a CDN.
const ALLOWED_CDNS = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdn.plot.ly",
].join(" ");

// Preview CSP for a presentHtml page. This HTML is LLM-authored, so the RESPONSE
// itself must sandbox it — not just the embedding iframe. `sandbox allow-scripts`
// (no allow-same-origin) gives the document an opaque origin even on DIRECT
// navigation to /artifacts/html/…, so its inline scripts can't reach the app
// origin's cookies / /api/* (matches the collection view-file hardening). The
// iframe (also sandbox="allow-scripts") renders identically — it was already
// opaque-origin. `connect-src 'none'` additionally blocks fetch/XHR (no phone-home);
// inline scripts + the CDN allowlist + images/media are allowed.
const HTML_PREVIEW_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  `script-src 'unsafe-inline' ${ALLOWED_CDNS}`,
  `style-src 'unsafe-inline' ${ALLOWED_CDNS}`,
  `font-src ${ALLOWED_CDNS}`,
  `img-src 'self' ${ALLOWED_CDNS} data: blob: https:`,
  `media-src 'self' https: data: blob:`,
  "connect-src 'none'",
].join("; ");

/** Intercept the View's dispatch (loadHtml/saveHtml) on /api/plugin/presentHtml,
 *  before the generic plugin catch-all (which handles the tool-call). MUST be
 *  registered BEFORE mountAllRoutes. */
export function mountHtmlDispatchRoute(app: Express): void {
  app.post("/api/plugin/presentHtml", async (req: Request, res: Response, next: NextFunction) => {
    const args = (req.body ?? {}) as { kind?: unknown; path?: unknown };
    // A tool-call (no `kind`) is left to the package execute via the catch-all.
    if (args.kind !== "loadHtml" && args.kind !== "saveHtml") return next();
    try {
      // `byPath` is what lets the source editor load/save a page OUTSIDE
      // artifacts/html — presentHtml's `path` form takes any .html on disk. Without
      // it the package degrades to its old artifacts-only behaviour.
      const result = await executeHtmlDispatch({ files: { artifacts: artifactsFileOps, byPath: htmlByPath } }, args as never);
      if (args.kind === "saveHtml" && typeof args.path === "string") {
        // Live-refresh via the shared publisher: the "html" scope forwards to
        // plugin:html:file:<path>, the channel the open View subscribes to.
        await publishFileChange(args.path);
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Serve `GET /artifacts/html/<rest>` — the iframe preview source — from the
 *  workspace, with the HTML preview CSP. Path-contained to artifacts/html. */
export function mountHtmlPreviewRoute(app: Express, deps: { workspace: string }): void {
  const root = path.resolve(deps.workspace, "artifacts", "html");
  app.get(/^\/artifacts\/html\/(.+)/, (req: Request, res: Response) => {
    const rel = req.params[0] ?? "";
    const abs = path.resolve(root, rel);
    if (!isWithin(root, abs)) {
      res.status(403).json({ error: "path escapes artifacts/html" });
      return;
    }
    if (!abs.toLowerCase().endsWith(".html")) {
      res.status(400).json({ error: "not an .html file" });
      return;
    }
    const stat = statFileOr404(res, abs);
    if (!stat) return;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", HTML_PREVIEW_CSP);
    streamFileToResponse(abs, res);
  });
}

// `.htm` as well as `.html`: the tool's `path` gate (isPresentableHtmlPath) accepts
// both, so refusing one here would mean a tool call that reports success and an iframe
// that always 404s.
const HTML_DOCUMENT_EXT_RE = /\.html?$/i;

/** Serve `GET /htmlfile/<scope>/<segments…>` — the iframe source for a page OUTSIDE
 *  `artifacts/html/`, which presentHtml's `path` form can be pointed at (the View
 *  builds this URL with htmlFileUrl). Same guards and the same CSP as the artifacts
 *  preview route above, with ONE deliberate difference: there is no containment root,
 *  because such a page legitimately lives anywhere on disk. The trust boundary is the
 *  loopback-only listener plus the same-origin guard — an iframe `src` can carry no
 *  Authorization header, so bearer auth was never part of it.
 *
 *  Unlike MulmoClaude's mount, this one serves DOCUMENTS only, not a page's images or
 *  media: MulmoTerminal's own /artifacts/html route has always been .html-only, and
 *  matching it keeps one answer for "what a presented page can load from disk".
 *
 *  NEVER split `reqPath` here. Segmenting before percent-decoding lets a `%2F` smuggle
 *  a separator past the `.`/`..`/dotfile checks; resolveHtmlFileRequestPath decodes
 *  per segment and refuses any that still contains one. */
export function mountHtmlFileRoute(app: Express): void {
  app.get(new RegExp(`^${HTML_FILE_MOUNT}/(.+)`), (req: Request, res: Response) => {
    const reqPath = req.params[0] ?? "";
    if (!HTML_DOCUMENT_EXT_RE.test(reqPath)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    void resolveHtmlRequest(reqPath)
      .then((abs) => {
        if (abs === null) {
          res.status(404).json({ error: "not found" });
          return;
        }
        // statSync follows symlinks, so isFile() judges the TARGET — a link to a
        // directory or a FIFO named `page.html` is refused rather than hanging a read.
        const stat = statFileOr404(res, abs);
        if (!stat) return;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", HTML_PREVIEW_CSP);
        streamFileToResponse(abs, res);
      })
      .catch(() => {
        if (!res.headersSent) res.status(404).json({ error: "not found" });
      });
  });
}
