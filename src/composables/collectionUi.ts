// Wire @mulmoclaude/collection-plugin/vue to MulmoTerminal. Imported for its side
// effect from main.ts so the package's View layer can resolve data before any
// presentCollection card mounts. MulmoTerminal's counterpart to MulmoClaude's
// src/composables/collections/uiHost.ts — but a much leaner host (no router, no
// vue-i18n host instance, no confirm/shortcut/notifier stores), so most write/chat/
// favorite capabilities are stubs for this read-side increment.
//
// What's REAL here: fetchCollectionDetail + listCollections (→ the server read
// routes over the shared workspace), localeTag, confirm. Everything else is a typed
// failure / no-op until the interactive (Tier 1) and toolbar (Tier 2) work lands.
import { defineComponent } from "vue";
import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
import type { CollectionApiResult } from "@mulmoclaude/collection-plugin/vue";
import type { CollectionDetailResponse, CollectionsListResponse, CollectionNotifySeverity } from "@mulmoclaude/collection-plugin";

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

// Shared "not supported yet" results for the write/feeds/view capabilities.
const UNSUPPORTED = "not supported in MulmoTerminal yet";
const apiFail = { ok: false as const, error: UNSUPPORTED, status: 501 };
const mutationFail = { ok: false as const, error: UNSUPPORTED };

// Renders nothing — MulmoTerminal has no favorites store yet (Tier 2).
const PinTogglePlaceholder = defineComponent({ name: "CollectionPinTogglePlaceholder", render: () => null });

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
  pinToggle: PinTogglePlaceholder,

  // ── asset URLs: MulmoTerminal has no general raw-file serving route yet, so
  //    image/file fields don't resolve (collections without them render fully). ──
  fileAssetUrl: () => null,
  fileRoutePath: () => null,
  imageSrc: () => "",

  // ── routing: no router; these are safe no-ops for an embedded card (wired to
  //    view-state in the Tier 2 toolbar). ──
  routeSlug: () => undefined,
  routeSelectedId: () => undefined,
  isFeedRoute: () => false,
  setSelectedId: () => {},
  gotoIndex: () => {},
  gotoDetail: () => {},
  navigateToRecord: () => {},

  // ── write / feeds / custom views: deferred to Tier 1. ──
  createItem: () => Promise.resolve(apiFail),
  updateItem: () => Promise.resolve(apiFail),
  deleteItem: () => Promise.resolve(mutationFail),
  deleteCollection: () => Promise.resolve(mutationFail),
  deleteFeed: () => Promise.resolve(mutationFail),
  runItemAction: () => Promise.resolve(apiFail),
  runCollectionAction: () => Promise.resolve(apiFail),
  refreshCollection: () => Promise.resolve(apiFail),
  deleteView: () => Promise.resolve(mutationFail),
  mintViewToken: () => Promise.resolve(apiFail),
  fetchViewHtml: () => Promise.resolve({ ok: false as const, status: 501 }),
  buildViewSrcdoc: () => "",
  listFeeds: () => Promise.resolve(apiFail),

  // ── favorites / chat / notifications: no stores yet (Tier 2). ──
  reconcileShortcuts: () => Promise.resolve(),
  unpin: () => Promise.resolve(false),
  startChat: () => {},
  notifiedSeverities: () => new Map<string, CollectionNotifySeverity>(),

  // ── Shadow-DOM modal target ── ShadowRoot is a valid Teleport target at runtime
  //    though the declared type is string | HTMLElement.
  modalTeleportTarget: () => (teleportStack[teleportStack.length - 1] ?? "body") as unknown as string | HTMLElement,
});
