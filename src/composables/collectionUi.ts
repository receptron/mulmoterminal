// Wire @mulmoclaude/collection-plugin/vue to MulmoTerminal. Imported for its side
// effect from main.ts so the package's View layer can resolve data before any
// presentCollection card mounts. MulmoTerminal's counterpart to MulmoClaude's
// src/composables/collections/uiHost.ts — a leaner host (no router, no vue-i18n host
// instance, no confirm/notifier stores).
//
// Wired: data fetch (detail/list), record CRUD, custom views (read-only desktop +
// read/write mobile phone-frame preview via fetchRemoteView/mutateRemoteView), actions
// (seed prompt → startChat → a visible chat), favorites (useShortcuts), feed/agent
// refresh + feed listing (via @mulmoclaude/core/feeds — see server/backends/feeds.ts),
// collection/feed/view deletion and the Discover registry tab (listRegistry/importRegistry
// via @mulmoclaude/core/collection — see server/backends/collections.ts), and state-based
// navigation (useCollectionBrowse — the toolbar + browse overlay).
// Still stubbed: the notifier.
import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
import type {
  CollectionApiResult,
  CollectionViewToken,
  CollectionActionResult,
  CollectionRemoteViewResult,
  CollectionRemoteViewMutateResult,
  CollectionRemoteViewItemsResult,
} from "@mulmoclaude/collection-plugin/vue";
import type {
  CollectionDetailResponse,
  CollectionsListResponse,
  CollectionOntologyResponse,
  CollectionNotifySeverity,
  ItemMutationResponse,
  FeedsListResponse,
} from "@mulmoclaude/core/collection";
import type { RegistryListResponse, RegistryImportResponse } from "@mulmoclaude/core/collection/registry";
import type { TranslateRequest, TranslateResponse } from "@mulmoclaude/core/translation/client";
import { buildCustomViewSrcdoc } from "../utils/customViewSrcdoc";
import { fetchJson } from "../utils/fetchJson";
import { htmlPreviewUrl, remoteViewItemsQuery, deleteErrorMessage } from "./collectionUiRules";
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
import { browserLocale } from "../utils/browserLocale";

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
const apiGet = <T>(url: string): Promise<CollectionApiResult<T>> => fetchJson<T>(url);

const apiSend = <T>(method: "POST" | "PUT", url: string, body: unknown): Promise<CollectionApiResult<T>> =>
  fetchJson<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const apiPost = <T>(url: string, body: unknown) => apiSend<T>("POST", url, body);
const apiPut = <T>(url: string, body: unknown) => apiSend<T>("PUT", url, body);

// Delete → the view layer's CollectionMutationResult ({ ok } | { ok:false, error }).
// On failure, surface the server's `{ error }` body (e.g. a delete-refusal reason
// like "preset collections can't be deleted") instead of a bare status code.
async function apiDelete(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null);
    return { ok: false, error: deleteErrorMessage(body, res.status) };
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

// The preview route (server/backends/html.ts → mountHtmlPreviewRoute) serves
// artifacts/html/*.html with the sandboxed preview CSP so it renders in a new tab;
// everything else falls back to the raw-file route. See htmlPreviewUrl.
configureCollectionUi({
  // ── real (read side) ──
  fetchCollectionDetail: (slug) => apiGet<CollectionDetailResponse>(`/api/collections/${encodeURIComponent(slug)}/detail`),
  listCollections: () => apiGet<CollectionsListResponse>("/api/collections/list"),
  // Map tab: raw workspace-ontology entries; the plugin builds the graph
  // client-side via the shared buildOntologyGraph (optional binding — omitting
  // it would just hide the tab).
  fetchOntology: () => apiGet<CollectionOntologyResponse>("/api/collections/ontology"),
  confirm: (options) => Promise.resolve(window.confirm(options.message)),
  // MulmoTerminal has no host i18n; the plugin runs its own. Pick the browser's
  // base language, defaulting to English.
  localeTag: () => browserLocale(),
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

  // ── mobile custom views (phone-frame preview): a `target: "mobile"` view is
  //    built HOST-side into its sandboxed srcdoc (server/backends/remoteView.ts,
  //    shared with the remote-host channel), so the desktop preview renders the
  //    exact artifact the phone gets. Optional + paired: providing both makes the
  //    view selector surface mobile views. Image thumbnails aren't inlined (no
  //    thumbnail store yet) — image fields render as placeholders, like the phone. ──
  fetchRemoteView: (slug, viewId, locale) =>
    apiGet<CollectionRemoteViewResult>(
      `/api/collections/${encodeURIComponent(slug)}/remote-view?id=${encodeURIComponent(viewId)}&locale=${encodeURIComponent(locale)}`,
    ),
  mutateRemoteView: (slug, viewId, request) =>
    apiPost<CollectionRemoteViewMutateResult>(`/api/collections/${encodeURIComponent(slug)}/remote-view/${encodeURIComponent(viewId)}/mutate`, request),
  // Page a mobile view's records the way the phone does — via getRemoteViewItems,
  // so the host projects to `fields` and inlines the view's declared image fields
  // as `data:` thumbnails. Without this the preview would page raw (CSP-blocked)
  // paths and show broken images.
  fetchRemoteViewItems: (slug, viewId, request) =>
    apiGet<CollectionRemoteViewItemsResult>(
      `/api/collections/${encodeURIComponent(slug)}/remote-view/${encodeURIComponent(viewId)}/items${remoteViewItemsQuery(request)}`,
    ),

  // MulmoTerminal serves no per-view translations — return the documented
  // "no i18n" shape ({ locale: "", dict: {} }) so the iframe's __MC_VIEW.t(key)
  // echoes keys instead of failing.
  fetchViewI18n: () => Promise.resolve({ ok: true as const, data: { locale: "", dict: {} } }),

  // ── record CRUD: create / update (e.g. checking a to-do item) / delete. ──
  createItem: (slug, record) => apiPost<ItemMutationResponse>(`/api/collections/${encodeURIComponent(slug)}/items`, record),
  updateItem: (slug, itemId, record) => apiPut<ItemMutationResponse>(itemUrl(slug, itemId), record),
  deleteItem: (slug, itemId) => apiDelete(itemUrl(slug, itemId)),

  // ── collection / feed delete (shared @mulmoclaude/core engines): archive-and-remove
  //    a collection, or drop a feed's registry entry. ──
  deleteCollection: (slug) => apiDelete(`/api/collections/${encodeURIComponent(slug)}`),
  deleteFeed: (slug) => apiDelete(`/api/feeds/${encodeURIComponent(slug)}`),
  // ── actions: kind "chat"/"agent" fetch the seed prompt + role (CollectionView
  //    feeds it to startChat → a visible chat); kind "mutate" carries the
  //    mini-form values as `params` and the server applies the write itself. ──
  runItemAction: (slug: string, itemId: string, actionId: string, params?: Record<string, unknown>) =>
    apiPost<CollectionActionResult>(
      `/api/collections/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/actions/${encodeURIComponent(actionId)}`,
      params ? { params } : {},
    ),
  runCollectionAction: (slug, actionId) =>
    apiPost<CollectionActionResult>(`/api/collections/${encodeURIComponent(slug)}/actions/${encodeURIComponent(actionId)}`, {}),
  refreshCollection: (slug) => apiPost(`/api/collections/${encodeURIComponent(slug)}/refresh`, {}),
  deleteView: (slug, viewId) => apiDelete(`/api/collections/${encodeURIComponent(slug)}/views/${encodeURIComponent(viewId)}`),
  listFeeds: () => apiGet<FeedsListResponse>("/api/feeds"),
  // ── Discover/registry tab: the shared @mulmoclaude/core registry engine, wired
  //    over /api/collections/registry/* (server/backends/collections.ts). ──
  listRegistry: () => apiGet<RegistryListResponse>("/api/collections/registry/list"),
  importRegistry: (author, slug, registry) => apiPost<RegistryImportResponse>("/api/collections/registry/import", { author, slug, registry }),

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
