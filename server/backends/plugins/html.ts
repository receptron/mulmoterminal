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
import type { Express, Request, Response } from "express";
import { executeHtmlDispatch, isHtmlDispatchArgs, HTML_FILE_MOUNT } from "@mulmoclaude/html-plugin";
import { SANDBOXED_VIEW_CDN_ALLOWLIST } from "@mulmoclaude/core/remote-view";
import { openVerifiedWithinScope, realpathIfPresent } from "@mulmoclaude/core/files";
import type { FileHandle } from "node:fs/promises";
import { artifactsFileOps } from "./artifacts.js";
import { htmlByPath, resolveHtmlRequest } from "../files/openPath.js";
import { mountSourceEditorDispatchRoute } from "../files/sourceEditorDispatchRoute.js";
import { statFileOr404 } from "../files/statFileOr404.js";
import { streamFileToResponse, streamHandleToResponse } from "../files/streamFile.js";
import { openVerifiedOr4xx } from "../files/openVerifiedOr4xx.js";
import type { Recheck } from "../../files/verifiedWrite.js";
import { isWithin } from "../../infra/fs/path-within.js";

// Curated CDN allowlist for an LLM-authored page that may pull a charting/util lib or font
// from a CDN. Core owns the list so this policy and the remote-view CSP can't drift — widen
// it THERE, never here. Every entry is a supply-chain surface, so html.spec.ts pins the
// resolved set: a core release that adds an origin fails that spec rather than silently
// widening what this host trusts.
const ALLOWED_CDNS = SANDBOXED_VIEW_CDN_ALLOWLIST.join(" ");

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

// Both preview routes end here, and it is one function because of WHICH headers these are: the
// CSP is what gives an LLM-authored page an opaque origin, so a mount that served HTML without
// it would run that page against the app's own origin. Both existing routes assert the header
// (test/server/backends/plugins/html.spec.ts) — this is what makes the NEXT mount inherit it rather
// than have to remember it.
//
// statSync follows symlinks, so isFile() judges the TARGET — a link to a directory or a FIFO
// named `page.html` is refused here rather than hanging a read.
//
// `recheck`, when the caller has one, is its containment check asked again once the file is open, and
// the page is then streamed from that descriptor (#3306).
export function sendHtmlDocument(res: Response, abs: string, recheck?: Recheck): void {
  if (!statFileOr404(res, abs)) return;
  const fd = recheck ? openVerifiedOr4xx(res, abs, recheck) : undefined;
  if (fd === null) return;
  setHtmlPreviewHeaders(res);
  streamFileToResponse(abs, res, undefined, fd);
}

function setHtmlPreviewHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", HTML_PREVIEW_CSP);
}

const ARTIFACTS_HTML_DIR = path.join("artifacts", "html");

/** The regular file at `relative` under artifacts/html, through a handle proven after opening to be the
 *  file that folder holds now — a link out of it, or a folder swapped for one, is null (#3310). */
async function openArtifactPage(workspace: string, relative: string): Promise<FileHandle | null> {
  const trustedReal = await realpathIfPresent(workspace);
  const handle = trustedReal === null ? null : await openVerifiedWithinScope({ trustedReal, scopeWithinTrusted: ARTIFACTS_HTML_DIR }, relative);
  if (handle === null) return null;
  if ((await handle.stat()).isFile()) return handle;
  await handle.close();
  return null;
}

async function sendArtifactPage(res: Response, workspace: string, relative: string): Promise<void> {
  const handle = await openArtifactPage(workspace, relative);
  if (handle === null) {
    res.status(404).json({ error: "not found" });
    return;
  }
  setHtmlPreviewHeaders(res);
  streamHandleToResponse(handle, res);
}

/** Intercept the View's dispatch (loadHtml/saveHtml) on /api/plugin/presentHtml,
 *  before the generic plugin catch-all (which handles the tool-call). MUST be
 *  registered BEFORE mountAllRoutes. */
export function mountHtmlDispatchRoute(app: Express): void {
  mountSourceEditorDispatchRoute(app, {
    route: "/api/plugin/presentHtml",
    loadKind: "loadHtml",
    saveKind: "saveHtml",
    isDispatchArgs: isHtmlDispatchArgs,
    invalidArgsError: "invalid presentHtml dispatch args",
    // `byPath` is what lets the source editor load/save a page OUTSIDE
    // artifacts/html — presentHtml's `path` form takes any .html on disk. Without
    // it the package degrades to its old artifacts-only behaviour.
    execute: (args) => executeHtmlDispatch({ files: { artifacts: artifactsFileOps, byPath: htmlByPath } }, args),
  });
}

/** Serve `GET /artifacts/html/<rest>` — the iframe preview source — from the
 *  workspace, with the HTML preview CSP. Contained to artifacts/html through links too, as
 *  MulmoClaude's mount is: the lexical check below answers a malformed path, and the verified open
 *  refuses a link out of the folder with the 404 of a missing page. */
export function mountHtmlPreviewRoute(app: Express, deps: { workspace: string }): void {
  const root = path.resolve(deps.workspace, ARTIFACTS_HTML_DIR);
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
    sendArtifactPage(res, deps.workspace, path.relative(root, abs)).catch(() => {
      if (!res.headersSent) res.status(404).json({ error: "not found" });
    });
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
        sendHtmlDocument(res, abs);
      })
      .catch(() => {
        if (!res.headersSent) res.status(404).json({ error: "not found" });
      });
  });
}
