// Project-scoped file browsing for the terminal header's 📁 Files menu. Unlike
// /api/files/raw (rooted at the single workspace, for the collection plugin), these
// take a `?cwd=` project dir — the directory the terminal's session runs in — so
// each terminal browses ITS OWN project. Read-only; GET-only (no mutation).
//
// Security: the same loopback/trusted-local-user posture as the worktree and session
// endpoints — any absolute existing dir is an allowed base — but `path` is always
// contained within that base (no `..`/absolute escape). Bytes are served sandboxed
// (see sendRawFile); rendered markdown is served under a sandbox CSP so embedded
// scripts can't run in the app origin.
import path from "node:path";
import fs from "node:fs";
import { marked } from "marked";
import type { Express, Request, Response } from "express";
import { sendRawFile } from "./backends/files.js";

// Resolve a client-supplied project dir: absolute + existing dir, else the default
// workspace (mirrors index.ts resolveWorkspace).
export function resolveBase(cwd: string | null, defaultCwd: string): string {
  if (cwd && path.isAbsolute(cwd)) {
    try {
      if (fs.statSync(cwd).isDirectory()) return cwd;
    } catch {
      // not a dir / missing — fall through to the default
    }
  }
  return defaultCwd;
}

// Resolve `rel` under `base`; return the absolute path only if it stays within base
// (reject `..` / absolute escapes). null = escapes the root.
export function containedPath(base: string, rel: string): string | null {
  const root = path.resolve(base);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

// Wrap marked's HTML output in a minimal, self-contained document.
export function mdToHtmlDoc(bodyHtml: string, title: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const style =
    "body{max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6}" +
    "pre{background:#f4f4f4;padding:1rem;overflow:auto}code{font-family:ui-monospace,monospace}img{max-width:100%}";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${style}</style></head><body>${bodyHtml}</body></html>`;
}

export interface BrowseEntry {
  name: string;
  dir: boolean;
  size: number;
}

function listEntries(absDir: string): BrowseEntry[] {
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .map((d) => {
      const dir = d.isDirectory();
      let size = 0;
      if (!dir) {
        try {
          size = fs.statSync(path.join(absDir, d.name)).size;
        } catch {
          size = 0;
        }
      }
      return { name: d.name, dir, size };
    })
    .sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1; // directories first
      return a.name.localeCompare(b.name);
    });
}

export function mountFilesBrowseRoutes(app: Express, deps: { defaultCwd: string }): void {
  const baseOf = (req: Request) => resolveBase(typeof req.query.cwd === "string" ? req.query.cwd : null, deps.defaultCwd);
  const relOf = (req: Request) => (typeof req.query.path === "string" ? req.query.path : "");

  app.get("/api/files/browse/list", (req: Request, res: Response) => {
    const root = baseOf(req);
    const abs = containedPath(root, relOf(req));
    if (!abs) {
      res.status(403).json({ error: "path escapes the project root" });
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!stat.isDirectory()) {
      res.status(400).json({ error: "not a directory" });
      return;
    }
    try {
      res.json({ cwd: path.resolve(root), path: relOf(req), entries: listEntries(abs) });
    } catch {
      res.status(500).json({ error: "failed to read directory" });
    }
  });

  app.get("/api/files/browse/raw", (req: Request, res: Response) => {
    const abs = containedPath(baseOf(req), relOf(req));
    if (!abs) {
      res.status(403).json({ error: "path escapes the project root" });
      return;
    }
    sendRawFile(req, res, abs);
  });

  app.get("/api/files/browse/md", async (req: Request, res: Response) => {
    const abs = containedPath(baseOf(req), relOf(req));
    if (!abs) {
      res.status(403).json({ error: "path escapes the project root" });
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      res.status(404).json({ error: "not found" });
      return;
    }
    const html = mdToHtmlDoc(await marked.parse(text), path.basename(abs));
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.send(html);
  });
}
