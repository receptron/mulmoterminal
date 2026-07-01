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
  writeItem,
  deleteItem,
  readItem,
  generateItemId,
  resolveCreateItemId,
  readSkillTemplate,
  buildActionSeedPrompt,
  buildCollectionActionSeedPrompt,
  toSummary,
  toDetail,
  validateCollectionRecords,
  deleteCollection,
  deleteCollectionRefusalMessage,
  deleteCustomView,
  type RecordIssue,
} from "@mulmoclaude/core/collection/server";
// CollectionItem + actionVisible live in the isomorphic core entry.
import { actionVisible, type CollectionItem } from "@mulmoclaude/core/collection";
// Curated-registry engine (Discover tab): merged catalog fetch + bundle import.
import { listRegistry, importRegistry } from "@mulmoclaude/core/collection/registry/server";
import { clampCapabilities, mintViewToken, requireViewToken, type ViewCapability } from "./viewToken.js";

// Console-backed logger matching the engine's CollectionLogger shape
// (prefix, message, optional structured data).
const log = {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => console.error(`[${prefix}] ${message}`, data ?? ""),
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => console.warn(`[${prefix}] ${message}`, data ?? ""),
  info: (prefix: string, message: string, data?: Record<string, unknown>) => console.log(`[${prefix}] ${message}`, data ?? ""),
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => console.debug(`[${prefix}] ${message}`, data ?? ""),
};

// The shared workspace root, captured at init so the registry import route can pass
// it to the engine (importRegistry takes it explicitly; the read side reads the host).
let workspaceRoot: string | null = null;

/** Wire the collection engine to the shared workspace. Call once at boot, before
 *  any collection route is hit. The path layout mirrors MulmoClaude verbatim. */
export function initCollectionsBackend(deps: { workspace: string }): void {
  workspaceRoot = deps.workspace;
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
      // <root>/config/collections-registries.json — extra Discover registries
      // (absent → official receptron/mulmoclaude-collections only).
      collectionsRegistriesConfig: (root) => path.join(root, "config", "collections-registries.json"),
    },
    // MulmoClaude's launcher preset namespace.
    isPresetSlug: (slug) => slug.startsWith("mc-") && slug.length > "mc-".length,
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A request body usable as a record: a non-null, non-array object. */
function extractRecord(body: unknown): CollectionItem | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as CollectionItem;
}

// A loaded collection, sans the null that `loadCollection` returns on a miss —
// derived here so the view-write helper doesn't need a fresh type import.
type ResolvedCollection = NonNullable<Awaited<ReturnType<typeof loadCollection>>>;

// Apply ONE per-record update for PUT /view-data. Returns the written item or a
// `{ rejected }` reason; kept out of the route handler so its loop stays flat
// (lint caps cognitive complexity). Enforces the same singleton invariant as
// PUT /items/:itemId — a singleton collection accepts only its one fixed id, so
// a write-capable custom view can't smuggle in arbitrary-id records. `merge` mode
// is update-only: the partial is layered onto the EXISTING record so untouched
// fields survive, and a missing id is rejected rather than upserted into a
// half-populated new record. `replace` mode writes the record as given (create or
// overwrite).
type ViewItemWriteResult = { item: CollectionItem } | { rejected: { id: string; problem: string } };

async function writeViewItem(collection: ResolvedCollection, raw: unknown, merge: boolean): Promise<ViewItemWriteResult> {
  const record = extractRecord(raw);
  if (!record) return { rejected: { id: "", problem: "item must be a JSON object" } };
  const { singleton, primaryKey } = collection.schema;
  const itemId = typeof record[primaryKey] === "string" ? (record[primaryKey] as string) : "";
  if (!itemId) return { rejected: { id: "", problem: `missing primary key '${primaryKey}'` } };
  if (singleton && itemId !== singleton) {
    return { rejected: { id: itemId, problem: `collection '${collection.slug}' is a singleton; the only valid item id is '${singleton}'` } };
  }
  let base: CollectionItem = {};
  if (merge) {
    const existing = await readItem(collection.dataDir, itemId);
    // Merge is update-only: don't upsert a missing id into a half-populated record.
    if (!existing) return { rejected: { id: itemId, problem: `item '${itemId}' not found (merge is update-only)` } };
    base = existing;
  }
  const recordWithId: CollectionItem = { ...base, ...record, [primaryKey]: itemId };
  const result = await writeItem(collection.dataDir, itemId, recordWithId, { slug: collection.slug });
  switch (result.kind) {
    case "ok":
      return { item: result.item };
    case "invalid-id":
      return { rejected: { id: itemId, problem: `invalid item id: ${itemId}` } };
    case "path-escape":
      return { rejected: { id: itemId, problem: "data directory escapes the workspace" } };
    default:
      return { rejected: { id: itemId, problem: `write failed (${result.kind})` } };
  }
}

/** Mount the read-side REST surface. Mirrors MulmoClaude's
 *  GET /api/collections + GET /api/collections/:slug response shapes, which is what
 *  the package's UI binding (fetchCollectionDetail / listCollections) expects. */
export function mountCollectionRoutes(app: Express): void {
  // Discover tab: the merged curated-registry catalog (every configured registry's
  // index.json, fetched + cached server-side). Registered before the ":slug" routes
  // so "registry" is never captured as a slug.
  app.get("/api/collections/registry/list", async (_req: Request, res: Response) => {
    try {
      res.json(await listRegistry());
    } catch (err) {
      log.warn("collections", "registry list failed", { error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Discover tab: install a registry collection into the shared workspace.
  app.post("/api/collections/registry/import", async (req: Request, res: Response) => {
    if (!workspaceRoot) {
      res.status(503).json({ error: "collections backend not initialized" });
      return;
    }
    const author = typeof req.body?.author === "string" ? req.body.author : "";
    const slug = typeof req.body?.slug === "string" ? req.body.slug : "";
    const registry = typeof req.body?.registry === "string" && req.body.registry ? req.body.registry : null;
    if (!author || !slug) {
      res.status(400).json({ error: "author and slug are required" });
      return;
    }
    try {
      const result = await importRegistry(author, slug, workspaceRoot, registry);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result.response);
    } catch (err) {
      log.warn("collections", "registry import failed", { error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Delete one custom view: drop it from the schema + unlink its HTML. Refuses
  // user-scope / preset collections (read-only), like collection delete.
  app.delete("/api/collections/:slug/views/:viewId", async (req: Request<{ slug: string; viewId: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    try {
      const result = await deleteCustomView(collection, req.params.viewId);
      if (result.kind !== "ok") {
        res.status(result.kind === "not-found" ? 404 : 403).json({ error: `view delete refused (${result.kind})` });
        return;
      }
      res.json({ deleted: true, viewId: result.viewId });
    } catch (err) {
      log.warn("collections", "view delete failed", { slug: req.params.slug, viewId: req.params.viewId, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Delete an entire collection (skill + records) after archiving a restorable
  // copy. Only project-scope, non-preset collections are deletable; a refusal
  // (preset / user-scope / unsafe path) comes back as 403 with the reason.
  app.delete("/api/collections/:slug", async (req: Request<{ slug: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    try {
      const result = await deleteCollection(collection);
      if (result.kind !== "ok") {
        res.status(403).json({ error: deleteCollectionRefusalMessage(result) });
        return;
      }
      res.json({ deleted: true, slug: result.slug, archivePath: result.archivePath });
    } catch (err) {
      log.warn("collections", "collection delete failed", { slug: req.params.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

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

  // ── Record CRUD (Tier 1: interactive editing — e.g. checking a to-do item) ──
  // Create a record. The id is the schema's primaryKey value from the body, or a
  // generated one; a singleton collection pins every create to its fixed id.
  app.post("/api/collections/:slug/items", async (req: Request<{ slug: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    const record = extractRecord(req.body);
    if (!record) {
      res.status(400).json({ error: "request body must be a JSON object" });
      return;
    }
    const itemId = resolveCreateItemId(collection.schema, record) ?? generateItemId();
    const recordWithId: CollectionItem = { ...record, [collection.schema.primaryKey]: itemId };
    try {
      const result = await writeItem(collection.dataDir, itemId, recordWithId, { refuseOverwrite: true });
      if (result.kind === "invalid-id") {
        res.status(400).json({ error: `invalid item id: ${result.itemId}` });
        return;
      }
      if (result.kind === "path-escape") {
        res.status(403).json({ error: `data directory for '${collection.slug}' escapes the workspace` });
        return;
      }
      if (result.kind === "conflict") {
        res.status(409).json({ error: `item '${result.itemId}' already exists` });
        return;
      }
      res.json({ itemId: result.itemId, item: result.item });
    } catch (err) {
      log.warn("collections", "item create failed", { slug: collection.slug, itemId, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Update a record. The primaryKey is pinned to the URL itemId (the body can't
  // smuggle a different id). Singletons only accept their one fixed id.
  app.put("/api/collections/:slug/items/:itemId", async (req: Request<{ slug: string; itemId: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    const record = extractRecord(req.body);
    if (!record) {
      res.status(400).json({ error: "request body must be a JSON object" });
      return;
    }
    const { singleton, primaryKey } = collection.schema;
    if (singleton && req.params.itemId !== singleton) {
      res.status(400).json({ error: `collection '${collection.slug}' is a singleton; the only valid item id is '${singleton}'` });
      return;
    }
    const recordWithId: CollectionItem = { ...record, [primaryKey]: req.params.itemId };
    try {
      const result = await writeItem(collection.dataDir, req.params.itemId, recordWithId);
      if (result.kind === "invalid-id") {
        res.status(400).json({ error: `invalid item id: ${result.itemId}` });
        return;
      }
      if (result.kind === "path-escape") {
        res.status(403).json({ error: `data directory for '${collection.slug}' escapes the workspace` });
        return;
      }
      if (result.kind === "conflict") {
        res.status(500).json({ error: "unexpected conflict on update" });
        return;
      }
      res.json({ itemId: result.itemId, item: result.item });
    } catch (err) {
      log.warn("collections", "item update failed", { slug: collection.slug, itemId: req.params.itemId, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Delete a record.
  app.delete("/api/collections/:slug/items/:itemId", async (req: Request<{ slug: string; itemId: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    try {
      const result = await deleteItem(collection.dataDir, req.params.itemId);
      if (result.kind === "invalid-id") {
        res.status(400).json({ error: `invalid item id: ${result.itemId}` });
        return;
      }
      if (result.kind === "path-escape") {
        res.status(403).json({ error: `data directory for '${collection.slug}' escapes the workspace` });
        return;
      }
      if (result.kind === "not-found") {
        res.status(404).json({ error: `item '${result.itemId}' not found` });
        return;
      }
      res.json({ deleted: true, itemId: result.itemId });
    } catch (err) {
      log.warn("collections", "item delete failed", { slug: collection.slug, itemId: req.params.itemId, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ── Actions (kind: "chat") — return a seed prompt + role; the frontend feeds it
  //    to startChat, which spawns a visible chat. The records are edited by that
  //    agent session directly (the intended model). ──

  // Per-record action (e.g. Repair / enrich this record).
  app.post(
    "/api/collections/:slug/items/:itemId/actions/:actionId",
    async (req: Request<{ slug: string; itemId: string; actionId: string }>, res: Response) => {
      const collection = await loadCollection(req.params.slug);
      if (!collection) {
        res.status(404).json({ error: `collection '${req.params.slug}' not found` });
        return;
      }
      const action = collection.schema.actions?.find((entry) => entry.id === req.params.actionId);
      if (!action) {
        res.status(404).json({ error: `action '${req.params.actionId}' not found on collection '${collection.slug}'` });
        return;
      }
      try {
        const record = await readItem(collection.dataDir, req.params.itemId);
        if (!record) {
          res.status(404).json({ error: `item '${req.params.itemId}' not found` });
          return;
        }
        // The action's `when` predicate is the authorization rule: the client hides
        // out-of-state buttons, but a stale/crafted request could still target one.
        if (!actionVisible(action, record)) {
          res.status(409).json({ error: `action '${action.id}' is not available for item '${req.params.itemId}' in its current state` });
          return;
        }
        const template = await readSkillTemplate(collection.skillDir, action.template);
        if (template === null) {
          res.status(500).json({ error: `template '${action.template}' for action '${action.id}' could not be read` });
          return;
        }
        res.json({ prompt: buildActionSeedPrompt(record, template), role: action.role });
      } catch (err) {
        log.warn("collections", "item action seed failed", {
          slug: collection.slug,
          itemId: req.params.itemId,
          actionId: req.params.actionId,
          error: errorMessage(err),
        });
        res.status(500).json({ error: errorMessage(err) });
      }
    },
  );

  // Collection-level action (operates over all records).
  app.post("/api/collections/:slug/actions/:actionId", async (req: Request<{ slug: string; actionId: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    const action = collection.schema.collectionActions?.find((entry) => entry.id === req.params.actionId);
    if (!action) {
      res.status(404).json({ error: `collection action '${req.params.actionId}' not found on collection '${collection.slug}'` });
      return;
    }
    try {
      const template = await readSkillTemplate(collection.skillDir, action.template);
      if (template === null) {
        res.status(500).json({ error: `template '${action.template}' for action '${action.id}' could not be read` });
        return;
      }
      const allItems = await listItems(collection.dataDir);
      res.json({ prompt: buildCollectionActionSeedPrompt(allItems, collection.schema, template), role: action.role });
    } catch (err) {
      log.warn("collections", "collection action seed failed", { slug: collection.slug, actionId: req.params.actionId, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ── Custom views (sandboxed-iframe HTML views, e.g. a poster gallery) ──
  // A custom view is LLM-authored HTML rendered in a sandboxed iframe that fetches
  // its records from view-data with a scoped token. Both tiers are wired: a GET
  // read route and a PUT write route (the latter gated by a `write`-capable token).

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
      // This is LLM-authored HTML. The frontend renders it sandboxed via a
      // fetch()→srcdoc iframe (not by navigating here), so harden the raw response
      // against DIRECT navigation: `sandbox` gives it an opaque origin (its scripts
      // can't reach the app origin's /api/*), and `nosniff` stops re-interpretation.
      // The iframe path is unaffected — a fetch() reads the body regardless of this
      // response-level CSP.
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
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
      // The write tier is wired below (PUT /view-data), so grant exactly what the
      // view declared. `clampCapabilities` defaults the requested set to the declared
      // set, so a `["read"]` view still can never obtain a `write` token.
      const granted = clampCapabilities(view.capabilities as ViewCapability[] | undefined, undefined);
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
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
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

  // Scoped write: apply per-record updates from a custom view (e.g. the vocabulary
  // flashcard's grade buttons). Requires a `write`-capable token. The body is
  // `{ items: [...], mode?: "merge" | "replace" }`; in `merge` mode (the default a
  // view sends when it only carries the changed fields) each item is layered onto the
  // existing record so untouched fields survive — a bare writeItem of the partial
  // would clobber them. Responds `{ items, rejected }`: `rejected` carries a
  // `{ id, problem }` per item that couldn't be written, the contract views check.
  app.put("/api/collections/:slug/view-data", viewDataCors, requireViewToken("write"), async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const collection = await loadCollection(req.params.slug);
      if (!collection) {
        res.status(404).json({ error: `collection '${req.params.slug}' not found` });
        return;
      }
      const body = (req.body ?? {}) as { items?: unknown; mode?: unknown };
      if (!Array.isArray(body.items)) {
        res.status(400).json({ error: "`items` must be an array" });
        return;
      }
      const merge = body.mode !== "replace";
      const written: CollectionItem[] = [];
      const rejected: Array<{ id: string; problem: string }> = [];
      for (const raw of body.items) {
        const outcome = await writeViewItem(collection, raw, merge);
        if ("item" in outcome) written.push(outcome.item);
        else rejected.push(outcome.rejected);
      }
      res.json({ items: written, rejected });
    } catch (err) {
      log.warn("collections", "view-data write failed", { slug: req.params.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
