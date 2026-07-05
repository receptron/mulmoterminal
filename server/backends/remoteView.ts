// Shared mobile custom-view builder, used by BOTH the remote-host command
// channel (remoteHost/handlers.ts → the phone) and the desktop collection routes
// (collections.ts → the phone-frame preview), so both render the identical
// artifact (preview === phone).
//
// Assemble one mobile (`target: "mobile"`) custom view for the remote client:
// find the view entry, read its HTML, pick its i18n dict for the requested
// locale, wrap it into the sandboxed srcdoc (CSP + postMessage bootstrap —
// @mulmoclaude/core/remote-view), and enforce the 1 MiB command-document budget.
// Also serves a view's record pages (getItems) and its writable-view mutates,
// with the same host-side policy enforcement MulmoClaude uses.
//
// Ported from MulmoClaude's server/workspace/collections/remoteView.ts. The one
// difference: MulmoTerminal has no thumbnail store, so image fields are never
// inlined — they stay as workspace paths (unrenderable on the phone) and count
// as `omitted`. Swap `noThumbnails` for a real resolver when a thumbnail store
// lands (the rest of the contract is identical, so the phone client is unchanged).
//
// Discriminated results (not throws) so the channel handlers can map each
// failure to an actionable message; factories keep the mapping unit-testable.
import {
  buildRemoteViewSrcdoc,
  clampImageMaxEdge,
  pageFromItems,
  REMOTE_VIEW_ITEMS_MAX_BYTES,
  REMOTE_VIEW_MAX_BYTES,
  type RemoteViewItem,
  type RemoteViewMutateRequest,
  type RemoteViewPage,
  type RemoteViewPageRequest,
} from "@mulmoclaude/core/remote-view";
import {
  deleteItem,
  enrichItems,
  listItems,
  readCustomViewHtml,
  readCustomViewI18n,
  readItem,
  safeRecordId,
  writeItem,
  type LoadedCollection,
} from "@mulmoclaude/core/collection/server";
import type { CollectionCustomView, CollectionItem, CollectionSchema } from "@mulmoclaude/core/collection";

// Resolves a workspace image path to a downscaled `data:` URL, or null when it
// can't (or won't). MulmoTerminal has no thumbnail store yet, so it never does.
type ThumbnailResolver = (imagePath: string, maxEdge: number) => Promise<string | null>;
const noThumbnails: ThumbnailResolver = async () => null;

export interface RemoteViewInfo {
  id: string;
  label: string;
  icon?: string;
  target: "mobile";
}

export type RemoteViewBuildResult =
  | { kind: "ok"; view: RemoteViewInfo; srcdoc: string; bytes: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "file-missing"; file: string }
  | { kind: "too-large"; bytes: number };

export interface BuildRemoteViewDeps {
  readCustomViewHtml: typeof readCustomViewHtml;
  readCustomViewI18n: typeof readCustomViewI18n;
}

export const createBuildRemoteView =
  (deps: BuildRemoteViewDeps) =>
  async (collection: LoadedCollection, viewId: string, locale: string): Promise<RemoteViewBuildResult> => {
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) return { kind: "view-not-found", viewId };
    // A desktop view's HTML assumes the token/dataUrl contract and would just
    // break on the phone — refuse it instead of serving a broken page.
    if (view.target !== "mobile") return { kind: "not-mobile", viewId };
    const html = await deps.readCustomViewHtml(collection, view.file);
    if (html === null) return { kind: "file-missing", file: view.file };
    const i18n = view.i18n ? await deps.readCustomViewI18n(collection, view.i18n, locale) : { locale: "", dict: {} };
    // `writable` gates the client-side updateItem/deleteItem install; the host
    // re-derives + enforces the actual policy on every mutate.
    const writable = isWritableView(view);
    const srcdoc = buildRemoteViewSrcdoc(html, { slug: collection.slug, locale: i18n.locale, dict: i18n.dict, writable });
    const bytes = Buffer.byteLength(srcdoc, "utf8");
    if (bytes > REMOTE_VIEW_MAX_BYTES) return { kind: "too-large", bytes };
    return { kind: "ok", view: { id: view.id, label: view.label, ...(view.icon ? { icon: view.icon } : {}), target: "mobile" }, srcdoc, bytes };
  };

export const buildRemoteView = createBuildRemoteView({ readCustomViewHtml, readCustomViewI18n });

/** One message per failure kind, thrown by the channel handler. */
export function remoteViewFailureMessage(result: Exclude<RemoteViewBuildResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "view-not-found") return `custom view '${result.viewId}' not found on collection '${slug}'`;
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "file-missing") return `view file '${result.file}' not found — author it at data/skills/${slug}/${result.file}`;
  return `mobile view srcdoc is ${result.bytes} bytes — over the ${REMOTE_VIEW_MAX_BYTES}-byte command-channel budget; slim the HTML`;
}

// ── Mutate (writable views) ──
// A `target: "mobile"` view's update/delete, authorized by its OWN declared
// surface (editableFields / allowDelete) and enforced HOST-side — the sandboxed
// client is never trusted.

/** True when a mobile view declared ANY write surface. Also gates the srcdoc's
 *  `writable` boot flag so the client only exposes methods the host will honor. */
function isWritableView(view: CollectionCustomView): boolean {
  return (view.editableFields?.length ?? 0) > 0 || view.allowDelete === true;
}

export type MutateRemoteViewResult =
  | { kind: "ok"; op: "update"; item: CollectionItem }
  | { kind: "ok"; op: "delete"; id: string }
  | { kind: "too-large"; bytes: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "not-writable"; viewId: string }
  | { kind: "field-not-editable"; field: string }
  | { kind: "delete-not-allowed" }
  | { kind: "invalid-patch" }
  | { kind: "item-not-found"; id: string }
  | { kind: "invalid-id"; id: string }
  | { kind: "path-escape" };

export interface MutateRemoteViewDeps {
  readItem: typeof readItem;
  writeItem: typeof writeItem;
  deleteItem: typeof deleteItem;
  enrichItems: typeof enrichItems;
  resolveThumbnail: ThumbnailResolver;
}

export const createMutateRemoteView =
  (deps: MutateRemoteViewDeps) =>
  async (collection: LoadedCollection, viewId: string, request: RemoteViewMutateRequest): Promise<MutateRemoteViewResult> => {
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) return { kind: "view-not-found", viewId };
    if (view.target !== "mobile") return { kind: "not-mobile", viewId };
    if (!isWritableView(view)) return { kind: "not-writable", viewId };
    if (request.op === "delete") return deleteViaView(deps, collection, view.allowDelete === true, request.id);
    return updateViaView(deps, collection, view, request);
  };

async function deleteViaView(deps: MutateRemoteViewDeps, collection: LoadedCollection, allowDelete: boolean, itemId: string): Promise<MutateRemoteViewResult> {
  if (!allowDelete) return { kind: "delete-not-allowed" };
  const result = await deps.deleteItem(collection.dataDir, itemId, { slug: collection.slug });
  if (result.kind === "invalid-id") return { kind: "invalid-id", id: result.itemId };
  if (result.kind === "path-escape") return { kind: "path-escape" };
  if (result.kind === "not-found") return { kind: "item-not-found", id: result.itemId };
  return { kind: "ok", op: "delete", id: result.itemId };
}

/** Validate the patch against the view's editable surface; null on success, a
 *  failure result otherwise. Split out so updateViaView stays small. */
function checkPatch(view: CollectionCustomView, primaryKey: string, patchKeys: string[]): MutateRemoteViewResult | null {
  if (patchKeys.length === 0) return { kind: "invalid-patch" };
  const allowed = new Set(view.editableFields ?? []);
  // The primary key is never patchable (it is the record id) even if listed.
  const offending = patchKeys.find((key) => key === primaryKey || !allowed.has(key));
  if (offending) return { kind: "field-not-editable", field: offending };
  return null;
}

async function updateViaView(
  deps: MutateRemoteViewDeps,
  collection: LoadedCollection,
  view: CollectionCustomView,
  request: Extract<RemoteViewMutateRequest, { op: "update" }>,
): Promise<MutateRemoteViewResult> {
  const { primaryKey } = collection.schema;
  const rejection = checkPatch(view, primaryKey, Object.keys(request.patch));
  if (rejection) return rejection;
  // Classify a bad id BEFORE readItem (which returns null for unsafe/escape/
  // missing alike) so update reports the same explicit invalid-id delete does.
  if (safeRecordId(request.id) === null) return { kind: "invalid-id", id: request.id };
  const existing = await deps.readItem(collection.dataDir, request.id, { slug: collection.slug });
  if (!existing) return { kind: "item-not-found", id: request.id };
  const merged: CollectionItem = { ...existing, ...request.patch, [primaryKey]: request.id };
  const result = await deps.writeItem(collection.dataDir, request.id, merged, { slug: collection.slug });
  if (result.kind === "invalid-id") return { kind: "invalid-id", id: result.itemId };
  if (result.kind === "path-escape") return { kind: "path-escape" };
  if (result.kind === "conflict") return { kind: "item-not-found", id: result.itemId }; // unreachable: refuseOverwrite is false
  // Shape the returned item like a getItems item — same host-computed fields
  // (derived, toggle, embed) — then inline the view's declared image fields.
  const [enriched] = await deps.enrichItems(collection, [result.item]);
  const item = enriched as RemoteViewItem;
  const baseBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
  if (baseBytes > REMOTE_VIEW_ITEMS_MAX_BYTES) return { kind: "too-large", bytes: baseBytes };
  const imageFields = inlineFields(view, collection.schema, undefined);
  if (imageFields.length > 0) {
    await inlineImages([item], imageFields, clampImageMaxEdge(view.imageMaxEdge), deps.resolveThumbnail, REMOTE_VIEW_ITEMS_MAX_BYTES - baseBytes);
  }
  return { kind: "ok", op: "update", item: item as CollectionItem };
}

export const mutateRemoteView = createMutateRemoteView({ readItem, writeItem, deleteItem, enrichItems, resolveThumbnail: noThumbnails });

// ── Item pages (getItems) ──
// A mobile view's record page: derive computed fields → slice/project (the same
// page semantics as getCollection) → inline the view's declared image fields as
// thumbnails (a no-op here without a thumbnail store — they stay paths, omitted).

export type RemoteViewItemsResult =
  | { kind: "ok"; page: RemoteViewPage; inlined: number; omitted: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "too-large"; bytes: number };

export interface RemoteViewItemsDeps {
  listItems: typeof listItems;
  enrichItems: typeof enrichItems;
  resolveThumbnail: ThumbnailResolver;
}

/** The declared image fields inlineable this page: image-type in the schema AND
 *  kept by the request's `fields` projection. A non-image declared field is
 *  ignored, not an error. */
function inlineFields(view: CollectionCustomView, schema: CollectionSchema, requested: string[] | undefined): string[] {
  const declared = view.imageFields ?? [];
  if (declared.length === 0) return [];
  const kept = requested ? new Set([schema.primaryKey, ...requested]) : null;
  return declared.filter((name) => schema.fields[name]?.type === "image" && (kept === null || kept.has(name)));
}

/** Replace declared image paths with thumbnail `data:` URLs in place, within a
 *  byte budget; a field left as its path counts as `omitted`. */
async function inlineImages(
  items: RemoteViewItem[],
  fields: string[],
  maxEdge: number,
  resolve: ThumbnailResolver,
  budget: number,
): Promise<{ inlined: number; omitted: number }> {
  let used = 0;
  let inlined = 0;
  let omitted = 0;
  for (const item of items) {
    for (const field of fields) {
      const value = item[field];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("data:")) continue;
      const dataUrl = used < budget ? await resolve(value, maxEdge) : null;
      if (dataUrl && used + dataUrl.length <= budget) {
        item[field] = dataUrl;
        used += dataUrl.length;
        inlined += 1;
      } else {
        omitted += 1;
      }
    }
  }
  return { inlined, omitted };
}

export const createRemoteViewItems =
  (deps: RemoteViewItemsDeps) =>
  async (collection: LoadedCollection, viewId: string, request: RemoteViewPageRequest): Promise<RemoteViewItemsResult> => {
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) return { kind: "view-not-found", viewId };
    if (view.target !== "mobile") return { kind: "not-mobile", viewId };
    // Hydrate through the same server resolver getItems uses (enrichItems): refs
    // loaded, derived formulas evaluated, toggles/embeds resolved — the phone
    // gets plain resolved scalars so mobile numbers match desktop exactly.
    const items = await deps.listItems(collection.dataDir);
    const derived = (await deps.enrichItems(collection, items)) as RemoteViewItem[];
    const page = pageFromItems(derived, request, collection.schema.primaryKey);
    const baseBytes = Buffer.byteLength(JSON.stringify(page), "utf8");
    if (baseBytes > REMOTE_VIEW_ITEMS_MAX_BYTES) return { kind: "too-large", bytes: baseBytes };
    const fields = inlineFields(view, collection.schema, request.fields);
    if (fields.length === 0) return { kind: "ok", page, inlined: 0, omitted: 0 };
    const budget = REMOTE_VIEW_ITEMS_MAX_BYTES - baseBytes;
    const { inlined, omitted } = await inlineImages(page.items, fields, clampImageMaxEdge(view.imageMaxEdge), deps.resolveThumbnail, Math.max(0, budget));
    return { kind: "ok", page, inlined, omitted };
  };

export const remoteViewItems = createRemoteViewItems({ listItems, enrichItems, resolveThumbnail: noThumbnails });

/** Message per non-ok item-page kind, thrown by the channel handler. */
export function remoteViewItemsFailureMessage(result: Exclude<RemoteViewItemsResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "too-large")
    return `mobile view page is ${result.bytes} bytes — over the ${REMOTE_VIEW_ITEMS_MAX_BYTES}-byte command-channel budget; narrow \`fields\` (drop an embed column), lower \`limit\`, or slim the records`;
  return `custom view '${result.viewId}' not found on collection '${slug}'`;
}

/** Message per non-ok mutate kind, thrown by the channel handler. */
export function mutateRemoteViewFailureMessage(result: Exclude<MutateRemoteViewResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "view-not-found") return `custom view '${result.viewId}' not found on collection '${slug}'`;
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "not-writable")
    return `mobile view '${result.viewId}' is read-only — declare editableFields and/or allowDelete in its views[] entry to allow writes`;
  if (result.kind === "field-not-editable")
    return `field '${result.field}' is not editable from this view — add it to the view's editableFields (the primary key is never editable)`;
  if (result.kind === "delete-not-allowed") return `this view may not delete records — set allowDelete: true in its views[] entry`;
  if (result.kind === "invalid-patch") return `update patch must be a non-empty object of field changes`;
  if (result.kind === "item-not-found") return `item '${result.id}' not found in collection '${slug}'`;
  if (result.kind === "invalid-id") return `invalid item id: ${result.id}`;
  if (result.kind === "too-large")
    return `update succeeded but its response is ${result.bytes} bytes — over the ${REMOTE_VIEW_ITEMS_MAX_BYTES}-byte command-channel budget; slim the record and re-fetch with \`getItems\``;
  return `data directory for collection '${slug}' escapes the workspace`;
}
