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
import type { Express, Request, Response, NextFunction } from "express";
import {
  configureCollectionHost,
  discoverCollections,
  loadCollection,
  listItems,
  enrichItems,
  readCustomViewHtml,
  toSummary,
  toDetail,
  validateCollectionRecords,
  type RecordIssue,
} from "@mulmoclaude/collection-plugin/server";
import { clampCapabilities, mintViewToken, requireViewToken, type ViewCapability } from "./viewToken.js";

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

  // ── Custom views (sandboxed-iframe HTML views, e.g. a poster gallery) ──
  // A custom view is LLM-authored HTML rendered in a sandboxed iframe that fetches
  // its records from view-data with a scoped token. Read-only here: the GET data
  // route is wired; write (PUT) is deferred to the interactive tier.

  // The custom view's raw HTML, read from the staging path via the package's
  // path-safe reader. The frontend renders it sandboxed (token injected).
  app.get("/api/collections/:slug/view-file", async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const { slug } = req.params;
      const viewId = typeof req.query.id === "string" ? req.query.id : "";
      const collection = await loadCollection(slug);
      if (!collection) {
        res.status(404).json({ error: `collection '${slug}' not found` });
        return;
      }
      const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
      if (!view) {
        res.status(404).json({ error: `custom view '${viewId}' not found on collection '${slug}'` });
        return;
      }
      const html = await readCustomViewHtml(collection, view.file);
      if (html === null) {
        res.status(404).json({ error: `view file '${view.file}' not found` });
        return;
      }
      res.type("text/html").send(html);
    } catch (err) {
      log.warn("collections", "view-file read failed", { slug: req.params.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Mint a scoped token for a custom view, clamped to what the view declared so a
  // read-only view can never obtain a write token.
  app.post("/api/collections/:slug/view-token", async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const { slug } = req.params;
      const body = (req.body ?? {}) as { viewId?: unknown; capabilities?: unknown };
      const viewId = typeof body.viewId === "string" ? body.viewId.trim() : "";
      if (!viewId) {
        res.status(400).json({ error: "`viewId` is required" });
        return;
      }
      const collection = await loadCollection(slug);
      if (!collection) {
        res.status(404).json({ error: `collection '${slug}' not found` });
        return;
      }
      const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
      if (!view) {
        res.status(404).json({ error: `custom view '${viewId}' not found on collection '${slug}'` });
        return;
      }
      // Read-only for now: MulmoTerminal has no view-data write route yet, so never
      // grant `write` even if the view declares it (clamp the request to ["read"]).
      // Drop the `write` clamp here once the interactive tier wires PUT /view-data.
      const granted = clampCapabilities(view.capabilities as ViewCapability[] | undefined, ["read"]);
      const minted = mintViewToken(slug, granted);
      res.json({ token: minted.token, exp: minted.exp, dataUrl: `/api/collections/${encodeURIComponent(slug)}/view-data`, capabilities: granted });
    } catch (err) {
      log.warn("collections", "view-token mint failed", { slug: req.params.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // CORS for the view-data endpoint: the sandboxed iframe has an opaque origin, so
  // its fetch is cross-origin and preflighted. `*` is safe — auth is the unguessable
  // scoped token in the Authorization header (not a cookie), so no ambient-credential
  // leak; an origin without the token just gets a 401.
  const viewDataCors = (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  };
  app.options("/api/collections/:slug/view-data", viewDataCors, (_req: Request, res: Response) => {
    res.status(204).end();
  });

  // Scoped read: the view's enriched records as `{ items }` — the shape custom views
  // fetch from `window.__MC_VIEW.dataUrl`. Guarded by the view token only.
  app.get("/api/collections/:slug/view-data", viewDataCors, requireViewToken("read"), async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const collection = await loadCollection(req.params.slug);
      if (!collection) {
        res.status(404).json({ error: `collection '${req.params.slug}' not found` });
        return;
      }
      const items = await enrichItems(collection, await listItems(collection.dataDir));
      res.json({ items });
    } catch (err) {
      log.warn("collections", "view-data read failed", { slug: req.params.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
