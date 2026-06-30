// Read-only wiki routes over the SHARED workspace (CLAUDE_CWD, default ~/mulmoclaude).
// MulmoTerminal is a second live view over the same `<workspace>/data/wiki/` that
// MulmoClaude writes — Claude authors the wiki via the real CLI in the terminal
// (Write/Edit), and this surface only browses. No POST: writes/snapshots stay
// host-side in MulmoClaude until MT grows a write tier.
//
// Every route is a thin pass-through to @mulmoclaude/core/wiki/server — the single
// shared reader (slug resolution, page index, graph, lint, frontmatter). MT does NOT
// reimplement any file-walking or YAML parsing, so the two apps cannot drift over the
// same files. The canonical on-disk layout lives in core's wikiDirs(), so both hosts
// agree on where the wiki sits.
import type { Express, Request, Response } from "express";
import { readWikiIndex, readWikiPage, loadWikiGraph, collectLintIssues } from "@mulmoclaude/core/wiki/server";
import { isSafeWikiSlug, formatLintReport } from "@mulmoclaude/core/wiki";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const log = {
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[wiki] ${message}`, data ?? ""),
};

/** Mount the read-only wiki REST surface, rooted at the shared workspace.
 *  Mirrors mountCollectionRoutes — call once at boot, before the /api SPA fallback. */
export function mountWikiRoutes(app: Express, deps: { workspace: string }): void {
  const { workspace } = deps;

  // The index, or a single page when `?slug=` is present. The page path is the same
  // route so the client can fetch index vs page through one endpoint.
  app.get("/api/wiki", async (req: Request, res: Response) => {
    const slug = req.query.slug;
    if (slug !== undefined) {
      // A crafted slug must never escape `data/wiki/pages` — guard before the read.
      // Containment is also enforced inside the core engine, but reject early here.
      if (!isSafeWikiSlug(slug)) {
        res.status(400).json({ error: `invalid wiki slug: ${String(slug)}` });
        return;
      }
      try {
        const page = await readWikiPage(workspace, slug);
        if (!page.exists) {
          res.status(404).json({ error: `wiki page '${slug}' not found` });
          return;
        }
        res.json(page);
      } catch (err) {
        log.warn("page read failed", { slug, error: errorMessage(err) });
        res.status(500).json({ error: errorMessage(err) });
      }
      return;
    }
    try {
      res.json(await readWikiIndex(workspace));
    } catch (err) {
      log.warn("index read failed", { error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // The page→page link graph (nodes + edges), for the graph view and backlinks.
  app.get("/api/wiki/graph", async (_req: Request, res: Response) => {
    try {
      res.json(await loadWikiGraph(workspace));
    } catch (err) {
      log.warn("graph read failed", { error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // The lint report (orphans, missing files, broken links, tag drift) as rendered
  // markdown — same report MulmoClaude writes, built from the shared rules.
  app.get("/api/wiki/lint", async (_req: Request, res: Response) => {
    try {
      const issues = await collectLintIssues(workspace);
      res.json({ issues, report: formatLintReport(issues) });
    } catch (err) {
      log.warn("lint failed", { error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
