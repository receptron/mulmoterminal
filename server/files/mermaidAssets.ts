// mermaid's own browser build, served by this server for the Markdown Preview (#2991). The Preview
// document is opaque-origin, and a module script it imports is fetched with CORS — so beyond being
// reachable, the one thing the asset needs is `Access-Control-Allow-Origin`. The CSP is untouched:
// the import is made by the nonce'd module script and carries its nonce (measured in Chromium and
// WebKit; see plans/feat-files-preview-mermaid.md).
//
// The version is in the URL, so a browser's cache never pairs one release's entry with another's
// chunks, and the files can be cached for good.
import path from "node:path";
import { createRequire } from "node:module";
import type { Express, Request, Response, NextFunction } from "express";
import { isRecord } from "../../common/isRecord.js";

export const MERMAID_ASSET_ROUTE = "/api/files/mermaid";
const ENTRY_FILE = "mermaid.esm.min.mjs";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** The ESM entry, or a module in its chunk directory (`chunk-…`, and one per diagram type such as
 *  `c4Diagram-…`) — and nothing else the package ships under `dist/`, whatever a request names: no
 *  source map, no declaration, no other build. */
const ASSET_PATH = /^\/([^/]+)\/(mermaid\.esm\.min\.mjs|chunks\/mermaid\.esm\.min\/[A-Za-z0-9_-]+\.mjs)$/;

/** The file under mermaid's `dist/` a request path names, or null. */
export function mermaidAssetFile(requestPath: string, version: string): string | null {
  const match = ASSET_PATH.exec(requestPath);
  return match && match[1] === version ? (match[2] ?? null) : null;
}

export const mermaidEntryUrl = (version: string): string => `${MERMAID_ASSET_ROUTE}/${version}/${ENTRY_FILE}`;

export interface MermaidDist {
  /** mermaid's `dist/` directory. */
  dir: string;
  version: string;
}

/** Where the installed mermaid keeps its browser build, resolved through the package itself so it is
 *  right wherever npm put it. */
export function installedMermaid(): MermaidDist {
  const require = createRequire(import.meta.url);
  const entry = require.resolve(`mermaid/dist/${ENTRY_FILE}`);
  const pkg: unknown = require("mermaid/package.json");
  const version = isRecord(pkg) && typeof pkg.version === "string" ? pkg.version : null;
  if (!version) throw new Error("mermaid/package.json: no version");
  return { dir: path.dirname(entry), version };
}

const serveAsset =
  (dist: MermaidDist) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const file = mermaidAssetFile(req.path, dist.version);
    if (!file) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // `root` so `send` resolves inside `dist/` on its own account as well; the allowlist above is
    // what refuses a `..` before it gets here.
    res.sendFile(file, { root: dist.dir, maxAge: ONE_YEAR_MS, immutable: true });
  };

/** Mount the asset route; returns the URL of the entry the Preview imports. */
export function mountMermaidAssetRoute(app: Express, dist: MermaidDist): string {
  app.use(MERMAID_ASSET_ROUTE, serveAsset(dist));
  return mermaidEntryUrl(dist.version);
}
