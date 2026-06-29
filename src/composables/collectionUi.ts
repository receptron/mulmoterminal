// Wire @mulmoclaude/collection-plugin/vue to MulmoTerminal. Imported for its side
// effect from main.ts so the package's View layer can resolve data before any
// presentCollection card mounts. MulmoTerminal's counterpart to MulmoClaude's
// src/composables/collections/uiHost.ts — a leaner host (no router, no vue-i18n host
// instance, no confirm/notifier stores).
//
// Wired: data fetch (detail/list), record CRUD, read-only custom views, actions
// (seed prompt → startChat → a visible chat), favorites (useShortcuts), feed/agent
// refresh (POST /api/collections/:slug/refresh via @mulmoclaude/core/feeds — see
// server/backends/feeds.ts), and state-based navigation (useCollectionBrowse — the
// toolbar + browse overlay).
// Still stubbed: feed listing (listFeeds), collection/view deletion, the Discover
// registry tab (listRegistry/importRegistry), and the notifier.
import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
import type { CollectionApiResult, CollectionViewToken, CollectionActionResult } from "@mulmoclaude/collection-plugin/vue";
import type { CollectionDetailResponse, CollectionsListResponse, CollectionNotifySeverity, ItemMutationResponse } from "@mulmoclaude/core/collection";
import type { TranslateRequest, TranslateResponse } from "@mulmoclaude/core/translation/client";
import { buildCustomViewSrcdoc } from "../utils/customViewSrcdoc";
import { useShortcuts } from "./useShortcuts";
import {
  browseGotoIndex,
  browseGotoDetail,
  browseNavigateToRecord,
  browseRouteSlug,
  browseRouteSelectedId,
  browseIsFeedRoute,
  browseSetSelectedId,
} from "./useCollectionBrowse";
import PinToggle from "../components/PinToggle.vue";
import { startCollectionChat } from "./useChatLauncher";

// ── Modal teleport target (Shadow DOM) ──
// PluginFrame mounts each card inside a per-instance shadow root, but
// configureCollectionUi sets ONE global binding — so it can't statically know which
// card's shadow root to teleport the record modal into. The card wrapper
// (CollectionCardView) registers its own shadow root here on mount via
// element.getRootNode(); the binding returns the top of the stack. Correct for the
// common single-open-card case; simultaneous modals across multiple cards fall back
// to the last-mounted card (accepted v1 limitation).
const teleportStack: Array<HTMLElement | ShadowRoot> = [];
export function pushCollectionTeleportTarget(target: HTMLElement | ShadowRoot): void {
  teleportStack.push(target);
}
export function popCollectionTeleportTarget(target: HTMLElement | ShadowRoot): void {
  const i = teleportStack.lastIndexOf(target);
  if (i >= 0) teleportStack.splice(i, 1);
}

// Read helper: normalise fetch into the package's CollectionApiResult (the view
// treats `ok:false` with `status` 404 as not-found, any other failure as a skip).
async function apiGet<T>(url: string): Promise<CollectionApiResult<T>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}

async function apiSend<T>(method: "POST" | "PUT", url: string, body: unknown): Promise<CollectionApiResult<T>> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}
const apiPost = <T>(url: string, body: unknown) => apiSend<T>("POST", url, body);
const apiPut = <T>(url: string, body: unknown) => apiSend<T>("PUT", url, body);

// Delete → the view layer's CollectionMutationResult ({ ok } | { ok:false, error }).
async function apiDelete(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "DELETE" });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Runtime UI-string translation transport for the collection plugin (e.g. the
// new-collection starter modal's card titles/descriptions/prompts). POSTs to
// MulmoTerminal's OWN /api/translation (server/backends/translation.ts → hidden-chat
// LLM); the request/response contract is the host-agnostic
// @mulmoclaude/core/translation/client. Resolves null on any failure so the plugin
// falls back to the English source. English is short-circuited server-side.
async function postTranslation(req: TranslateRequest): Promise<TranslateResponse | null> {
  try {
    const res = await fetch("/api/translation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) return null;
    return (await res.json()) as TranslateResponse;
  } catch {
    return null;
  }
}

const itemUrl = (slug: string, itemId: string) => `/api/collections/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}`;

/** Browser URL for a workspace-relative file path, via the raw-file route. */
function rawFileUrl(value: unknown): string {
  return `/api/files/raw?path=${encodeURIComponent(String(value))}`;
}

// A `file` field holding an `artifacts/html/*.html` path points at an
// LLM-authored page. The raw-file route serves it as octet-stream (no `.html`
// in its MIME map) so the browser downloads it; the dedicated preview route
// (server/backends/html.ts → mountHtmlPreviewRoute) serves it as text/html
// with the sandboxed preview CSP, so it renders in a new tab. Detect that
// shape and return the preview URL; everything else falls back to rawFileUrl.
const HTML_PREVIEW_DIR_PREFIX = "artifacts/html/";
function htmlPreviewUrl(value: string): string | null {
  if (!value.toLowerCase().endsWith(".html")) return null;
  if (!value.startsWith(HTML_PREVIEW_DIR_PREFIX)) return null;
  const rest = value.slice(HTML_PREVIEW_DIR_PREFIX.length);
  if (rest.length === 0) return null;
  return `/artifacts/html/${rest.split("/").map(encodeURIComponent).join("/")}`;
}

// Shared "not supported yet" results for the write/feeds/view capabilities.
const UNSUPPORTED = "not supported in MulmoTerminal yet";
const apiFail = { ok: false as const, error: UNSUPPORTED, status: 501 };
const mutationFail = { ok: false as const, error: UNSUPPORTED };

configureCollectionUi({
  // ── real (read side) ──
  fetchCollectionDetail: (slug) => apiGet<CollectionDetailResponse>(`/api/collections/${encodeURIComponent(slug)}/detail`),
  listCollections: () => apiGet<CollectionsListResponse>("/api/collections/list"),
  confirm: (options) => Promise.resolve(window.confirm(options.message)),
  // MulmoTerminal has no host i18n; the plugin runs its own. Pick the browser's
  // base language, defaulting to English.
  localeTag: () => (navigator.language || "en").split("-")[0],
  generalRoleId: "general",
  personalRoleId: "personal",
  pinToggle: PinToggle,

  // ── asset URLs → the raw workspace-file route (server/backends/files.ts).
  //    Mirrors MulmoClaude's resolveImageSrc: data: URIs pass through, everything
  //    else resolves to /api/files/raw?path=<workspace-relative>. fileRoutePath
  //    (in-app File Explorer nav) stays null — MulmoTerminal has no file explorer. ──
  imageSrc: (imageData) => (typeof imageData === "string" && imageData.startsWith("data:") ? imageData : rawFileUrl(imageData)),
  fileAssetUrl: (value) => (typeof value === "string" && value.length > 0 ? (htmlPreviewUrl(value) ?? rawFileUrl(value)) : null),
  fileRoutePath: () => null,

  // ── navigation: no router — map onto useCollectionBrowse's view-state, which
  //    drives the full-screen browse overlay + the toolbar launcher. ──
  routeSlug: () => browseRouteSlug(),
  routeSelectedId: () => browseRouteSelectedId(),
  isFeedRoute: () => browseIsFeedRoute(),
  setSelectedId: (itemId) => browseSetSelectedId(itemId),
  gotoIndex: (kind) => browseGotoIndex(kind),
  gotoDetail: (kind, slug) => browseGotoDetail(kind, slug),
  navigateToRecord: (targetSlug, recordId) => browseNavigateToRecord(targetSlug, recordId),

  // ── custom views (read-only): sandboxed-iframe HTML views over the shared
  //    workspace. Mint a scoped token, fetch the view HTML, and wrap it in a
  //    CSP-locked srcdoc with the token injected. ──
  mintViewToken: (slug, viewId) => apiPost<CollectionViewToken>(`/api/collections/${encodeURIComponent(slug)}/view-token`, { viewId }),
  fetchViewHtml: async (slug, viewId) => {
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(slug)}/view-file?id=${encodeURIComponent(viewId)}`);
      return res.ok ? { ok: true as const, html: await res.text() } : { ok: false as const, status: res.status };
    } catch {
      return { ok: false as const, status: 0 };
    }
  },
  buildViewSrcdoc: (html, boot) => buildCustomViewSrcdoc(html, boot),
  // MulmoTerminal serves no per-view translations — return the documented
  // "no i18n" shape ({ locale: "", dict: {} }) so the iframe's __MC_VIEW.t(key)
  // echoes keys instead of failing.
  fetchViewI18n: () => Promise.resolve({ ok: true as const, data: { locale: "", dict: {} } }),

  // ── record CRUD: create / update (e.g. checking a to-do item) / delete. ──
  createItem: (slug, record) => apiPost<ItemMutationResponse>(`/api/collections/${encodeURIComponent(slug)}/items`, record),
  updateItem: (slug, itemId, record) => apiPut<ItemMutationResponse>(itemUrl(slug, itemId), record),
  deleteItem: (slug, itemId) => apiDelete(itemUrl(slug, itemId)),

  // ── collection/feed delete, actions, feeds, view-delete: deferred. ──
  deleteCollection: () => Promise.resolve(mutationFail),
  deleteFeed: () => Promise.resolve(mutationFail),
  // ── actions (kind: "chat"): fetch the seed prompt + role; CollectionView feeds it
  //    to startChat (→ a visible chat). ──
  runItemAction: (slug, itemId, actionId) =>
    apiPost<CollectionActionResult>(
      `/api/collections/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/actions/${encodeURIComponent(actionId)}`,
      {},
    ),
  runCollectionAction: (slug, actionId) =>
    apiPost<CollectionActionResult>(`/api/collections/${encodeURIComponent(slug)}/actions/${encodeURIComponent(actionId)}`, {}),
  refreshCollection: (slug) => apiPost(`/api/collections/${encodeURIComponent(slug)}/refresh`, {}),
  deleteView: () => Promise.resolve(mutationFail),
  listFeeds: () => Promise.resolve(apiFail),
  // ── Discover/registry tab: no curated-registry backend in MulmoTerminal. ──
  listRegistry: () => Promise.resolve(apiFail),
  importRegistry: () => Promise.resolve(apiFail),

  // ── favorites: the shared useShortcuts store over /api/shortcuts. ──
  reconcileShortcuts: (kind, live) => useShortcuts().reconcile(kind, live),
  unpin: (kind, slug) => useShortcuts().unpin(kind, slug),
  // ── chat: spawn a new terminal session seeded with the prompt and surface it
  //    (hidden=false → make it visible). Backs the index "create" button + the
  //    collection/record action buttons (Repair, etc.). MulmoTerminal has no roles,
  //    so `role` is ignored. ──
  startChat: (prompt) => void startCollectionChat(prompt, { hidden: false }),
  // Open a chat with the prompt prefilled as an editable DRAFT (not auto-sent) — the
  // new-collection template cards + custom views. The text is typed into claude's PTY
  // input box without an Enter (server: spawnBackgroundChat draft:true), so the user
  // reviews / edits / sends. `role` is ignored (MulmoTerminal has no roles).
  startNewChatDraft: (prompt) => void startCollectionChat(prompt, { hidden: false, draft: true }),
  // No notifier in MulmoTerminal.
  notifiedSeverities: () => new Map<string, CollectionNotifySeverity>(),

  // ── runtime translation: POST /api/translation (hidden-chat LLM). Enables the
  //    new-collection starter modal's localized cards; omitted ⇒ English fallback. ──
  translate: postTranslation,

  // ── Shadow-DOM modal target ── ShadowRoot is a valid Teleport target at runtime
  //    though the declared type is string | HTMLElement.
  modalTeleportTarget: () => (teleportStack[teleportStack.length - 1] ?? "body") as unknown as string | HTMLElement,
});
