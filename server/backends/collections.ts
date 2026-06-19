// Read-side backend for @mulmoclaude/collection-plugin. MulmoTerminal is a second
// live view over the SHARED workspace (CLAUDE_CWD, default ~/mulmoclaude) — it does
// not render a passed-in snapshot. The presentCollection chat card passes only a
// slug to CollectionView, which then calls the UI binding's fetchCollectionDetail()
// → GET /api/collections/:slug/detail here to load the live schema + records. So
// this engine wiring is required even for a read-only card.
//
// The path layout below MUST match MulmoClaude's exactly (see
// mulmoclaude/server/workspace/{skills,feeds}/paths.ts + skills-preset.ts) so
// discovery finds the same collection skills both apps share on disk.
//
// Only the read side is wired here (list + detail). Write routes (CRUD / actions /
// custom views) and the manageCollection MCP tool are deferred to the interactive
// tier.
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";
import {
  configureCollectionHost,
  discoverCollections,
  loadCollection,
  listItems,
  toSummary,
  toDetail,
  validateCollectionRecords,
  type RecordIssue,
} from "@mulmoclaude/collection-plugin/server";

// Console-backed logger matching the engine's CollectionLogger shape
// (prefix, message, optional structured data).
const log = {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => console.error(`[${prefix}] ${message}`, data ?? ""),
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => console.warn(`[${prefix}] ${message}`, data ?? ""),
  info: (prefix: string, message: string, data?: Record<string, unknown>) => console.log(`[${prefix}] ${message}`, data ?? ""),
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => console.debug(`[${prefix}] ${message}`, data ?? ""),
};

/** Wire the collection engine to the shared workspace. Call once at boot, before
 *  any collection route is hit. The path layout mirrors MulmoClaude verbatim. */
export function initCollectionsBackend(deps: { workspace: string }): void {
  configureCollectionHost({
    workspaceRoot: deps.workspace,
    log,
    paths: {
      // ~/.claude/skills — user scope (read-only).
      userSkillsDir: path.join(os.homedir(), ".claude", "skills"),
      // <root>/.claude/skills — project scope.
      projectSkillsDir: (root) => path.join(root, ".claude", "skills"),
      // <root>/feeds — feed registry root.
      feedsRoot: (root) => path.join(root, "feeds"),
      // <root>/data/skills — project-skills staging.
      skillsStagingDir: (root) => path.join(root, "data", "skills"),
      // Workspace-relative archive dir (removed collections move here).
      archiveDir: "archive",
    },
    // MulmoClaude's launcher preset namespace.
    isPresetSlug: (slug) => slug.startsWith("mc-") && slug.length > "mc-".length,
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Mount the read-side REST surface. Mirrors MulmoClaude's
 *  GET /api/collections + GET /api/collections/:slug response shapes, which is what
 *  the package's UI binding (fetchCollectionDetail / listCollections) expects. */
export function mountCollectionRoutes(app: Express): void {
  // List skill-backed collections for the index + toolbar.
  app.get("/api/collections/list", async (_req: Request, res: Response) => {
    try {
      const collections = await discoverCollections();
      res.json({ collections: collections.map(toSummary) });
    } catch (err) {
      log.warn("collections", "list failed", { error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // A collection's live schema + records by slug. Backs both the card's own load
  // (CollectionView reads `status` for 404 → not-found) and ref/embed resolution.
  app.get("/api/collections/:slug/detail", async (req: Request<{ slug: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    try {
      const items = await listItems(collection.dataDir);
      // Best-effort validation: a malformed record is silently skipped at read
      // time, so surface the problems here too and let the view offer a Repair
      // button. Never let validation failure turn a successful detail into a 500.
      let issues: RecordIssue[] = [];
      try {
        issues = await validateCollectionRecords(collection);
      } catch (err) {
        log.warn("collections", "detail validation skipped", { slug: collection.slug, error: errorMessage(err) });
      }
      // Omit `issues` entirely when everything is fine (the "absent when clean"
      // contract the view relies on).
      res.json({ collection: toDetail(collection), items, ...(issues.length > 0 ? { issues } : {}) });
    } catch (err) {
      log.warn("collections", "detail failed", { slug: collection.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
