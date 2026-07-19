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
// Read routes (list + detail), write routes (CRUD / actions / custom views), and
// the registry Discover routes all live here. The manageCollection MCP tool (the
// agent's data plane over the same engine) is a host tool — see
// server/infra/collection-tool.ts + the dispatch route in server/index.ts.
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import {
  configureCollectionHost,
  discoverCollections,
  loadCollection,
  enrichItems,
  readCustomViewHtml,
  validateRecordObject,
  generateItemId,
  resolveCreateItemId,
  readSkillTemplate,
  buildActionSeedPrompt,
  buildCollectionActionSeedPrompt,
  promptPathsFor,
  getWorkspaceRoot,
  toSummary,
  toDetail,
  validateCollectionRecords,
  deleteCollection,
  deleteCollectionRefusalMessage,
  deleteCustomView,
  applyMutateAction,
  collectionWritable,
  readOnlyRefusal,
  storeFor,
  type LoadedCollection,
  type RecordIssue,
} from "@mulmoclaude/core/collection/server";
import type { CollectionMutateAction } from "@mulmoclaude/core/collection";
// CollectionItem + actionVisible live in the isomorphic core entry.
import { actionVisible, type CollectionItem } from "@mulmoclaude/core/collection";
// Curated-registry engine (Discover tab): merged catalog fetch + bundle import.
import { listRegistry, importRegistry } from "@mulmoclaude/core/collection/registry/server";
import { clampLimit as clampViewLimit, clampOffset as clampViewOffset, normalizeFields, normalizeMutate } from "@mulmoclaude/core/remote-view";
// Mobile custom-view builder — shared with the remote-host channel handlers so
// the desktop phone-frame preview renders the EXACT artifact the phone receives.
import {
  buildRemoteView,
  mutateRemoteView,
  remoteViewFailureMessage,
  mutateRemoteViewFailureMessage,
  remoteViewItems,
  remoteViewItemsFailureMessage,
} from "./remoteView.js";
import { clampCapabilities, mintViewToken, requireViewToken, type ViewCapability } from "./viewToken.js";
// The shared manageCollection binding — the query route reuses its queryItems
// action so a view can never do more than the agent's own data plane.
import { manageCollectionHandler } from "../infra/collection-tool.js";
import { hostLogger } from "./hostLogger.js";

// Console-backed logger matching the engine's CollectionLogger shape
// (prefix, message, optional structured data) — shared with the other engines'
// `configure*Host({ log })` bindings.
const log = hostLogger;

// Skill roots — the single source of truth for where skills live on disk, shared
// with the collection engine (below) AND the remote-host listSkills scanner
// (remoteHost/skills.ts) so both scan the exact same directories and stay
// consistent about the skill/collection split.
/** `~/.claude/skills` — user scope (read-only). */
export const userSkillsDir = (): string => path.join(os.homedir(), ".claude", "skills");
/** `<root>/.claude/skills` — project scope. */
export const projectSkillsDir = (root: string): string => path.join(root, ".claude", "skills");

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
      userSkillsDir: userSkillsDir(),
      // <root>/.claude/skills — project scope.
      projectSkillsDir,
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

// The write modes a custom view's PUT may request, matching the documented
// __MC_VIEW contract (@mulmoclaude/core help: custom-view.md).
type ViewWriteMode = "merge" | "upsert" | "create";
const VIEW_WRITE_MODES: readonly ViewWriteMode[] = ["merge", "upsert", "create"];

// Apply ONE per-record write for PUT /view-data. Returns the written id or a
// `{ rejected }` reason; kept out of the route handler so its loop stays flat
// (lint caps cognitive complexity). Behavior mirrors manageCollection's putItems:
//  - `merge`  — layer the partial onto the EXISTING record (update-only; a missing
//               id is rejected, never upserted into a half-populated record).
//  - `create` — insert-only; an existing id collides.
//  - `upsert` — write the record as given (create or overwrite); the default.
// Also enforces the singleton invariant (only the fixed id is writable) and gates
// every row on the schema (required fields, enum values, id↔primaryKey) so a bad
// row comes back in `rejected` with an actionable `problem` instead of persisting.
type ViewItemWriteResult = { writtenId: string } | { rejected: { id: string; problem: string } };

async function writeViewItem(collection: ResolvedCollection, raw: unknown, mode: ViewWriteMode): Promise<ViewItemWriteResult> {
  const record = extractRecord(raw);
  if (!record) return { rejected: { id: "", problem: "item must be a JSON object" } };
  const { singleton, primaryKey } = collection.schema;
  const itemId = typeof record[primaryKey] === "string" ? (record[primaryKey] as string) : "";
  if (!itemId) return { rejected: { id: "", problem: `missing primary key '${primaryKey}'` } };
  if (singleton && itemId !== singleton) {
    return { rejected: { id: itemId, problem: `collection '${collection.slug}' is a singleton; the only valid item id is '${singleton}'` } };
  }
  // Reads and writes go through the collection's STORE (file, sqlite, …);
  // presence of `write` IS the writability check (core 0.25 storage seam).
  const store = storeFor(collection);
  const { write } = store;
  if (!write) return { rejected: { id: itemId, problem: readOnlyRefusal(collection.slug) } };
  let toWrite: CollectionItem;
  if (mode === "merge") {
    const existing = await store.read(itemId);
    if (!existing) return { rejected: { id: itemId, problem: `item '${itemId}' not found — use "upsert" or "create" to add it` } };
    toWrite = { ...existing, ...record, [primaryKey]: itemId };
  } else {
    toWrite = { ...record, [primaryKey]: itemId };
  }
  const problem = validateRecordObject(toWrite, itemId, collection.schema);
  if (problem) return { rejected: { id: itemId, problem } };
  const result = await write(itemId, toWrite, { refuseOverwrite: mode === "create" });
  // Handle each WriteItemResult kind; the final case (`path-escape`) is the
  // fallthrough return so `result` narrows cleanly instead of hitting a `never`
  // default (mirrors manageCollection.putOneItem in MulmoClaude).
  if (result.kind === "ok") return { writtenId: result.itemId };
  if (result.kind === "invalid-id") return { rejected: { id: itemId, problem: `'${itemId}' is not a valid record id` } };
  if (result.kind === "conflict")
    return { rejected: { id: itemId, problem: `'${itemId}' already exists — mode "create" refuses overwrite; use "upsert" to update it` } };
  return { rejected: { id: itemId, problem: "write refused: the collection's data dir escapes the workspace" } };
}

/** A `fields` projection arrives as a CSV query (`?fields=title,photo`) or
 *  repeated params; hand `normalizeFields` an array either way. */
function csvParam(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return undefined;
}

/** HTTP status for a non-ok remote-view mutate (message via
 *  mutateRemoteViewFailureMessage): 404 for a missing view/record, 403 for a
 *  policy refusal, 400 otherwise. */
function mutateStatus(kind: string): number {
  if (kind === "view-not-found" || kind === "item-not-found") return 404;
  if (kind === "read-only-collection") return 405;
  if (kind === "not-writable" || kind === "delete-not-allowed" || kind === "field-not-editable" || kind === "path-escape") return 403;
  return 400;
}

// ── Route handlers ──────────────────────────────────────────────────────────
// One named handler per endpoint (kept small + individually testable); the wiring
// list is mountCollectionRoutes at the bottom. All read module-level state
// (workspaceRoot) + the imported engine functions — no per-request closure.

// Discover tab: the merged curated-registry catalog (every configured registry's
// index.json, fetched + cached server-side).
const registryListHandler: RequestHandler = async (_req, res) => {
  try {
    res.json(await listRegistry());
  } catch (err) {
    log.warn("collections", "registry list failed", { error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// Discover tab: install a registry collection into the shared workspace.
const registryImportHandler: RequestHandler = async (req, res) => {
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
};

// Delete one custom view: drop it from the schema + unlink its HTML. Refuses
// user-scope / preset collections (read-only), like collection delete.
const viewDeleteHandler: RequestHandler<{ slug: string; viewId: string }> = async (req, res) => {
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
};

// Delete an entire collection (skill + records) after archiving a restorable
// copy. Only project-scope, non-preset collections are deletable; a refusal
// (preset / user-scope / unsafe path) comes back as 403 with the reason.
const collectionDeleteHandler: RequestHandler<{ slug: string }> = async (req, res) => {
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
};

// List skill-backed collections for the index + toolbar.
const listHandler: RequestHandler = async (_req, res) => {
  try {
    const collections = await discoverCollections();
    res.json({ collections: collections.map(toSummary) });
  } catch (err) {
    log.warn("collections", "list failed", { error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// A collection's live schema + records by slug. Backs both the card's own load
// (CollectionView reads `status` for 404 → not-found) and ref/embed resolution.
const detailHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    res.status(404).json({ error: `collection '${req.params.slug}' not found` });
    return;
  }
  try {
    const items = await storeFor(collection).list();
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
};

// ── Record CRUD (Tier 1: interactive editing — e.g. checking a to-do item) ──
// Create a record. The id is the schema's primaryKey value from the body, or a
// generated one; a singleton collection pins every create to its fixed id.
const itemCreateHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    res.status(404).json({ error: `collection '${req.params.slug}' not found` });
    return;
  }
  const createStore = storeFor(collection).write;
  if (!createStore) {
    res.status(405).json({ error: readOnlyRefusal(collection.slug) });
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
    const result = await createStore(itemId, recordWithId, { refuseOverwrite: true });
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
};

// Update a record. The primaryKey is pinned to the URL itemId (the body can't
// smuggle a different id). Singletons only accept their one fixed id.
const itemUpdateHandler: RequestHandler<{ slug: string; itemId: string }> = async (req, res) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    res.status(404).json({ error: `collection '${req.params.slug}' not found` });
    return;
  }
  const updateStore = storeFor(collection).write;
  if (!updateStore) {
    res.status(405).json({ error: readOnlyRefusal(collection.slug) });
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
    const result = await updateStore(req.params.itemId, recordWithId);
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
};

// Delete a record.
const itemDeleteHandler: RequestHandler<{ slug: string; itemId: string }> = async (req, res) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    res.status(404).json({ error: `collection '${req.params.slug}' not found` });
    return;
  }
  const deleteStore = storeFor(collection).delete;
  if (!deleteStore) {
    res.status(405).json({ error: readOnlyRefusal(collection.slug) });
    return;
  }
  try {
    const result = await deleteStore(req.params.itemId);
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
};

// ── Actions (kind: "chat") — return a seed prompt + role; the frontend feeds it
//    to startChat, which spawns a visible chat. The records are edited by that
//    agent session directly (the intended model). ──

// Execute a `kind: "mutate"` action: validate the mini-form params, merge the
// resolved `set` over the record through the standard write gate, and answer
// with the written record so the client updates the open panel in place. The
// engine work lives in `applyMutateAction` (core); this maps its outcome to
// HTTP, mirroring MulmoClaude's host.
const respondForMutateAction = async (
  res: Response,
  collection: LoadedCollection,
  action: CollectionMutateAction,
  itemId: string,
  body: { params?: unknown } | undefined,
): Promise<void> => {
  const raw = body?.params;
  const params = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const outcome = await applyMutateAction(collection, action, itemId, params);
  if (!outcome.ok) {
    // `itemId` is caller-controlled (a route param) — strip CR/LF so a crafted
    // id can't forge log lines.
    log.info("collections", "mutate action refused", {
      slug: collection.slug,
      itemId: itemId.replace(/[\r\n]/g, " "),
      actionId: action.id,
      status: outcome.status,
      problem: outcome.problem,
    });
    if (outcome.status === "not-found") res.status(404).json({ error: outcome.problem });
    else if (outcome.status === "require-unmet") res.status(409).json({ error: outcome.problem });
    else if (outcome.status === "write-refused") res.status(500).json({ error: outcome.problem });
    else res.status(400).json({ error: outcome.problem });
    return;
  }
  log.info("collections", "mutate action applied", { slug: collection.slug, itemId: itemId.replace(/[\r\n]/g, " "), actionId: action.id });
  res.json({ written: true, itemId, item: outcome.item });
};

// Per-record action (e.g. Repair / enrich this record).
const itemActionHandler: RequestHandler<{ slug: string; itemId: string; actionId: string }> = async (req, res) => {
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
    const record = await storeFor(collection).read(req.params.itemId);
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
    // `kind: "mutate"` needs no template / seed / LLM — the host applies the
    // declarative write itself (`when` was just enforced above, same
    // visibility-is-authorization rule as the seeded kinds).
    if (action.kind === "mutate") {
      // Schema validation already rejects mutate actions on a dataSource
      // collection; this is the defensive server-side twin.
      if (!collectionWritable(collection)) {
        res.status(405).json({ error: readOnlyRefusal(collection.slug) });
        return;
      }
      await respondForMutateAction(res, collection, action, req.params.itemId, req.body as { params?: unknown } | undefined);
      return;
    }
    const template = await readSkillTemplate(collection.skillDir, action.template);
    if (template === null) {
      res.status(500).json({ error: `template '${action.template}' for action '${action.id}' could not be read` });
      return;
    }
    // Pass the collection paths so the seed prompt carries the <collection_paths>
    // block — the skill template needs skillDir/dataPath to find its files.
    const paths = promptPathsFor(collection, getWorkspaceRoot());
    res.json({ prompt: buildActionSeedPrompt(record, template, paths), role: action.role });
  } catch (err) {
    log.warn("collections", "item action seed failed", {
      slug: collection.slug,
      itemId: req.params.itemId,
      actionId: req.params.actionId,
      error: errorMessage(err),
    });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// Collection-level action (operates over all records).
const collectionActionHandler: RequestHandler<{ slug: string; actionId: string }> = async (req, res) => {
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
  // Schema validation already rejects mutate in `collectionActions` (no record
  // to write); this is the defensive twin that also narrows the type.
  if (action.kind === "mutate") {
    res.status(400).json({ error: `collection action '${action.id}' has kind "mutate" — mutate actions are record-level only` });
    return;
  }
  try {
    const template = await readSkillTemplate(collection.skillDir, action.template);
    if (template === null) {
      res.status(500).json({ error: `template '${action.template}' for action '${action.id}' could not be read` });
      return;
    }
    const allItems = await storeFor(collection).list();
    const paths = promptPathsFor(collection, getWorkspaceRoot());
    res.json({ prompt: buildCollectionActionSeedPrompt(allItems, collection.schema, template, paths), role: action.role });
  } catch (err) {
    log.warn("collections", "collection action seed failed", { slug: collection.slug, actionId: req.params.actionId, error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// ── Custom views (sandboxed-iframe HTML views, e.g. a poster gallery) ──
// A custom view is LLM-authored HTML rendered in a sandboxed iframe that fetches
// its records from view-data with a scoped token. Both tiers are wired: a GET
// read route and a PUT write route (the latter gated by a `write`-capable token).

// The custom view's raw HTML, read from the staging path via the package's
// path-safe reader. The frontend renders it sandboxed (token injected).
const viewFileHandler: RequestHandler<{ slug: string }> = async (req, res) => {
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
};

// Serve a mobile (`target: "mobile"`) custom view wrapped into its sandboxed
// srcdoc — the desktop phone-frame preview's data source. Same builder as the
// remote-host channel's `getRemoteView`, so the preview renders the exact
// artifact the phone receives (preview === phone).
const remoteViewHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const { slug } = req.params;
  const viewId = typeof req.query.id === "string" ? req.query.id : "";
  const locale = typeof req.query.locale === "string" ? req.query.locale : "";
  const collection = await loadCollection(slug);
  if (!collection) {
    res.status(404).json({ error: `collection '${slug}' not found` });
    return;
  }
  try {
    const result = await buildRemoteView(collection, viewId, locale);
    if (result.kind !== "ok") {
      const notFound = result.kind === "view-not-found" || result.kind === "file-missing";
      res.status(notFound ? 404 : 400).json({ error: remoteViewFailureMessage(result, slug) });
      return;
    }
    res.json({ view: result.view, srcdoc: result.srcdoc, bytes: result.bytes });
  } catch (err) {
    log.warn("collections", "remote-view build failed", { slug, error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// Apply one update/delete on behalf of a writable mobile view — the desktop
// preview's write channel. Same builder + host-side policy as the channel's
// `mutateRemoteViewItem`, so a preview mutation runs the exact enforcement the
// phone will.
const remoteViewMutateHandler: RequestHandler<{ slug: string; viewId: string }> = async (req, res) => {
  const { slug, viewId } = req.params;
  const request = normalizeMutate((req.body ?? {}) as { op?: unknown; id?: unknown; patch?: unknown });
  if (!request) {
    res.status(400).json({ error: "invalid mutate request — expected { op: 'update'|'delete', id, patch? }" });
    return;
  }
  const collection = await loadCollection(slug);
  if (!collection) {
    res.status(404).json({ error: `collection '${slug}' not found` });
    return;
  }
  try {
    const result = await mutateRemoteView(collection, viewId, request);
    if (result.kind !== "ok") {
      res.status(mutateStatus(result.kind)).json({ error: mutateRemoteViewFailureMessage(result, slug) });
      return;
    }
    res.json(result.op === "delete" ? { op: "delete", id: result.id } : { op: "update", item: result.item });
  } catch (err) {
    log.warn("collections", "remote-view mutate failed", { slug, viewId, error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// One page of a mobile view's records, with its declared image fields inlined
// as `data:` thumbnails — the desktop phone-frame preview's paging source. Same
// builder as the channel's getRemoteViewItems, so the preview pages the exact
// data (real thumbnails) the phone gets.
const remoteViewItemsHandler: RequestHandler<{ slug: string; viewId: string }> = async (req, res) => {
  const { slug, viewId } = req.params;
  const request = { offset: clampViewOffset(req.query.offset), limit: clampViewLimit(req.query.limit), fields: normalizeFields(csvParam(req.query.fields)) };
  const collection = await loadCollection(slug);
  if (!collection) {
    res.status(404).json({ error: `collection '${slug}' not found` });
    return;
  }
  try {
    const result = await remoteViewItems(collection, viewId, request);
    if (result.kind !== "ok") {
      res.status(result.kind === "view-not-found" ? 404 : 400).json({ error: remoteViewItemsFailureMessage(result, slug) });
      return;
    }
    res.json({ page: result.page, inlined: result.inlined, omitted: result.omitted });
  } catch (err) {
    log.warn("collections", "remote-view items failed", { slug, viewId, error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// Mint a scoped token for a custom view, clamped to what the view declared so a
// read-only view can never obtain a write token.
const viewTokenHandler: RequestHandler<{ slug: string }> = async (req, res) => {
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
};

// CORS for the view-data endpoint: the sandboxed iframe has an opaque origin, so
// its fetch is cross-origin and preflighted. `*` is safe — auth is the unguessable
// scoped token in the Authorization header (not a cookie), so no ambient-credential
// leak; an origin without the token just gets a 401.
const viewDataCors = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  next();
};

// Scoped read: the view's enriched records as `{ items }` — the shape custom views
// fetch from `window.__MC_VIEW.dataUrl`. Guarded by the view token only.
const viewDataGetHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  try {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    const items = await enrichItems(collection, await storeFor(collection).list());
    res.json({ items });
  } catch (err) {
    log.warn("collections", "view-data read failed", { slug: req.params.slug, error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// Scoped write: apply per-record updates from a custom view (e.g. the vocabulary
// flashcard's grade buttons). Requires a `write`-capable token. Body is
// `{ items: [...], mode?: "merge" | "upsert" | "create" }`, matching the documented
// __MC_VIEW contract; `mode` defaults to `upsert` (write the record as given). The
// response envelope is `{ written, rejected }` — `written` is the id of each stored
// record, `rejected` a `{ id, problem }` per row that failed — the shape views read.
const viewDataPutHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  try {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    if (!collectionWritable(collection)) {
      res.status(405).json({ error: readOnlyRefusal(collection.slug) });
      return;
    }
    const body = (req.body ?? {}) as { items?: unknown; mode?: unknown };
    if (!Array.isArray(body.items)) {
      res.status(400).json({ error: "`items` must be an array" });
      return;
    }
    const mode: ViewWriteMode = body.mode === undefined ? "upsert" : (body.mode as ViewWriteMode);
    if (!VIEW_WRITE_MODES.includes(mode)) {
      const modeList = VIEW_WRITE_MODES.map((m) => `"${m}"`).join(", ");
      res.status(400).json({ error: `\`mode\` must be one of ${modeList}` });
      return;
    }
    const written: string[] = [];
    const rejected: Array<{ id: string; problem: string }> = [];
    for (const raw of body.items) {
      const outcome = await writeViewItem(collection, raw, mode);
      if ("writtenId" in outcome) written.push(outcome.writtenId);
      else rejected.push(outcome.rejected);
    }
    res.json({ written, rejected });
  } catch (err) {
    log.warn("collections", "view-data write failed", { slug: req.params.slug, error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

/** Per-slug in-flight cap for view-issued aggregation queries — each one
 *  can be a full-file DuckDB scan, so a runaway dashboard loop must not
 *  stack dozens of concurrent scans. Mirrors MulmoClaude's guard. */
const VIEW_QUERY_MAX_CONCURRENT = 4;
const inflightViewQueries = new Map<string, number>();
const viewQueryConcurrency = (req: Request<{ slug?: string }>, res: Response, next: NextFunction): void => {
  const slug = req.params.slug ?? "";
  const current = inflightViewQueries.get(slug) ?? 0;
  if (current >= VIEW_QUERY_MAX_CONCURRENT) {
    res.status(429).json({ error: "too many concurrent queries for this collection — retry shortly" });
    return;
  }
  inflightViewQueries.set(slug, current + 1);
  let released = false;
  res.once("close", () => {
    if (released) return;
    released = true;
    const now = inflightViewQueries.get(slug) ?? 1;
    if (now <= 1) inflightViewQueries.delete(slug);
    else inflightViewQueries.set(slug, now - 1);
  });
  next();
};

// Scoped aggregation: run a structured query (the DSL — never raw SQL) over
// the collection. Read capability only (the DSL is read-only by construction).
// Reuses the shared manageCollection handler so a view can never do more than
// the agent's own queryItems (same validation, same engines: dataSource → the
// whole-CSV DuckDB scan; file-backed → the enriched-JSONL path). Errors return
// a FIXED message — raw engine errors can carry host paths, and a scoped view
// is not a trusted audience for those.
const viewDataQueryHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  try {
    const body = (req.body ?? {}) as { query?: unknown };
    const raw = await manageCollectionHandler({ action: "queryItems", slug: req.params.slug, query: body.query });
    try {
      res.json(JSON.parse(raw));
    } catch {
      res.status(400).json({ error: raw });
    }
  } catch (err) {
    log.warn("collections", "view-data query failed", { slug: req.params.slug.replace(/[\r\n]/g, " "), error: errorMessage(err) });
    res.status(500).json({ error: "collection query failed" });
  }
};

/** Mount the read-side REST surface. Mirrors MulmoClaude's
 *  GET /api/collections + GET /api/collections/:slug response shapes, which is what
 *  the package's UI binding (fetchCollectionDetail / listCollections) expects.
 *  One app.METHOD(path, handler) per endpoint — the handlers live above. */
export function mountCollectionRoutes(app: Express): void {
  // Registered before the ":slug" routes so "registry" is never captured as a slug.
  app.get("/api/collections/registry/list", registryListHandler);
  app.post("/api/collections/registry/import", registryImportHandler);

  app.delete("/api/collections/:slug/views/:viewId", viewDeleteHandler);
  app.delete("/api/collections/:slug", collectionDeleteHandler);

  app.get("/api/collections/list", listHandler);
  app.get("/api/collections/:slug/detail", detailHandler);

  app.post("/api/collections/:slug/items", itemCreateHandler);
  app.put("/api/collections/:slug/items/:itemId", itemUpdateHandler);
  app.delete("/api/collections/:slug/items/:itemId", itemDeleteHandler);

  app.post("/api/collections/:slug/items/:itemId/actions/:actionId", itemActionHandler);
  app.post("/api/collections/:slug/actions/:actionId", collectionActionHandler);

  app.get("/api/collections/:slug/view-file", viewFileHandler);
  app.get("/api/collections/:slug/remote-view", remoteViewHandler);
  app.post("/api/collections/:slug/remote-view/:viewId/mutate", remoteViewMutateHandler);
  app.get("/api/collections/:slug/remote-view/:viewId/items", remoteViewItemsHandler);

  app.post("/api/collections/:slug/view-token", viewTokenHandler);
  app.options("/api/collections/:slug/view-data", viewDataCors, (_req: Request, res: Response) => {
    res.status(204).end();
  });
  app.get("/api/collections/:slug/view-data", viewDataCors, requireViewToken("read"), viewDataGetHandler);
  app.put("/api/collections/:slug/view-data", viewDataCors, requireViewToken("write"), viewDataPutHandler);
  app.options("/api/collections/:slug/view-data/query", viewDataCors, (_req: Request, res: Response) => {
    res.status(204).end();
  });
  app.post("/api/collections/:slug/view-data/query", viewDataCors, viewQueryConcurrency, requireViewToken("read"), viewDataQueryHandler);
}
