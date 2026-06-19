// Wire @mulmoclaude/collection-plugin/vue to MulmoTerminal. Imported for its side
// effect from main.ts so the package's View layer can resolve data before any
// presentCollection card mounts. MulmoTerminal's counterpart to MulmoClaude's
// src/composables/collections/uiHost.ts — but a much leaner host (no router, no
// vue-i18n host instance, no confirm/shortcut/notifier stores), so most write/chat/
// favorite capabilities are stubs for this read-side increment.
//
// What's REAL here: fetchCollectionDetail + listCollections, the read-only custom
// view surface (mintViewToken / fetchViewHtml / buildViewSrcdoc), localeTag, confirm.
// Write / feeds / favorites / chat are typed failures / no-ops until the interactive
// (Tier 1) and toolbar (Tier 2) work lands.
import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
import type { CollectionApiResult, CollectionViewToken } from "@mulmoclaude/collection-plugin/vue";
import type { CollectionDetailResponse, CollectionsListResponse, CollectionNotifySeverity } from "@mulmoclaude/collection-plugin";
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

async function apiPost<T>(url: string, body: unknown): Promise<CollectionApiResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}

/** Browser URL for a workspace-relative file path, via the raw-file route. */
function rawFileUrl(value: unknown): string {
  return `/api/files/raw?path=${encodeURIComponent(String(value))}`;
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
  fileAssetUrl: (value) => (typeof value === "string" && value.length > 0 ? rawFileUrl(value) : null),
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

  // ── write / feeds / view-delete: deferred to Tier 1. ──
  createItem: () => Promise.resolve(apiFail),
  updateItem: () => Promise.resolve(apiFail),
  deleteItem: () => Promise.resolve(mutationFail),
  deleteCollection: () => Promise.resolve(mutationFail),
  deleteFeed: () => Promise.resolve(mutationFail),
  runItemAction: () => Promise.resolve(apiFail),
  runCollectionAction: () => Promise.resolve(apiFail),
  refreshCollection: () => Promise.resolve(apiFail),
  deleteView: () => Promise.resolve(mutationFail),
  listFeeds: () => Promise.resolve(apiFail),

  // ── favorites: the shared useShortcuts store over /api/shortcuts. ──
  reconcileShortcuts: (kind, live) => useShortcuts().reconcile(kind, live),
  unpin: (kind, slug) => useShortcuts().unpin(kind, slug),
  // ── chat / notifications: no chat-seed hook or notifier in MulmoTerminal. ──
  startChat: () => {},
  notifiedSeverities: () => new Map<string, CollectionNotifySeverity>(),

  // ── Shadow-DOM modal target ── ShadowRoot is a valid Teleport target at runtime
  //    though the declared type is string | HTMLElement.
  modalTeleportTarget: () => (teleportStack[teleportStack.length - 1] ?? "body") as unknown as string | HTMLElement,
});
