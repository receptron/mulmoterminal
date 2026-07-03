// Project-scoped file browsing + editing for the full-screen Files view. Takes a
// `?cwd=` project dir (the directory a terminal's session runs in) so each terminal
// browses/edits ITS OWN project. list/text/md are read-only GETs; write is a PUT.
//
// Security: the same loopback/trusted-local-user posture as the worktree/session
// endpoints — any absolute existing dir is an allowed base — but `path` is always
// contained within that base (no `..`/absolute escape), for reads AND writes. Rendered
// markdown is served under a sandbox CSP so embedded scripts can't run in the app origin.
import path from "node:path";
import fs from "node:fs";
import { marked } from "marked";
import type { Express, Request, Response } from "express";

// Cap on the bytes served to the editor / accepted on write — a text editor, not a
// blob store. Large/binary files are refused rather than streamed into a textarea.
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

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

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p; // doesn't exist yet (a new file being written) — use the lexical path
  }
}

// Lexical containment (containedPath) can be defeated by a SYMLINK inside the project
// that points outside it. This resolves symlinks in the path's existing portion (a
// not-yet-created write target has none) and confirms the real path still lands within
// `base`. Returns the real absolute path, or null if it escapes.
export function realContainedWithin(base: string, absLexical: string): string | null {
  const root = realpathOr(path.resolve(base));
  const rest: string[] = [];
  let existing = absLexical;
  while (!fs.existsSync(existing)) {
    rest.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    existing = parent;
  }
  const real = rest.length ? path.resolve(realpathOr(existing), ...rest) : realpathOr(existing);
  if (real !== root && !real.startsWith(root + path.sep)) return null;
  return real;
}

// Wrap marked's HTML output in a minimal, self-contained document (served sandboxed).
export function mdToHtmlDoc(bodyHtml: string, title: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const style =
    "body{max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a2e}" +
    "pre{background:#f4f4f4;padding:1rem;overflow:auto}code{font-family:ui-monospace,monospace}img{max-width:100%}";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${style}</style></head><body>${bodyHtml}</body></html>`;
}

export interface BrowseEntry {
  name: string;
  dir: boolean;
  size: number;
}

// Directory listing, directories first then files, each alphabetical. Dotfiles are
// kept (a project's config often lives in them) but node_modules/.git are noisy —
// still listed; the UI can collapse them.
export function listEntries(absDir: string): BrowseEntry[] {
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

  // Resolve `path` under the request's project base; 403 if it escapes — lexically OR
  // through a symlink. Centralises the containment check so every route (read AND write)
  // shares one gate.
  const contained = (req: Request, res: Response): string | null => {
    const base = baseOf(req);
    const lexical = containedPath(base, relOf(req));
    const abs = lexical ? realContainedWithin(base, lexical) : null;
    if (!abs) {
      res.status(403).json({ error: "path escapes the project root" });
      return null;
    }
    return abs;
  };

  app.get("/api/files/browse/list", (req, res) => {
    const root = baseOf(req);
    const abs = contained(req, res);
    if (!abs) return;
    try {
      if (!fs.statSync(abs).isDirectory()) return res.status(400).json({ error: "not a directory" });
      res.json({ cwd: path.resolve(root), path: relOf(req), entries: listEntries(abs) });
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.get("/api/files/browse/text", (req, res) => {
    const abs = contained(req, res);
    if (!abs) return;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return res.status(400).json({ error: "not a file" });
      if (stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: "file too large to edit" });
      res.json({ text: fs.readFileSync(abs, "utf8") });
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.get("/api/files/browse/md", async (req, res) => {
    const abs = contained(req, res);
    if (!abs) return;
    let text: string;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return res.status(400).json({ error: "not a file" });
      // Same cap as /text and /write, so a huge file can't be read+parsed by marked.
      if (stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: "file too large" });
      text = fs.readFileSync(abs, "utf8");
    } catch {
      return res.status(404).json({ error: "not found" });
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.send(mdToHtmlDoc(await marked.parse(text), path.basename(abs)));
  });

  app.put("/api/files/browse/write", (req, res) => {
    const abs = contained(req, res);
    if (!abs) return;
    const text = req.body?.text;
    if (typeof text !== "string") return res.status(400).json({ error: "body.text (string) required" });
    if (Buffer.byteLength(text, "utf8") > MAX_EDIT_BYTES) return res.status(413).json({ error: "content too large" });
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return res.status(400).json({ error: "path is a directory" });
      fs.writeFileSync(abs, text, "utf8");
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "failed to write file" });
    }
  });
}
