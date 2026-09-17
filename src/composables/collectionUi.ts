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
// Google-calendar push (via @mulmoclaude/core/google — see server/backends/calendarPush.ts),
// collection/feed/view deletion and the Discover registry tab (listRegistry/importRegistry
// via @mulmoclaude/core/collection — see server/backends/collections.ts), and state-based
// navigation (useCollectionBrowse — the toolbar + browse overlay), and the live bell's
// per-record severities (useNotifications → the Kanban accent).
import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
import type {
  CollectionApiResult,
  CollectionViewToken,
  CollectionActionResult,
  CollectionRemoteViewResult,
  CollectionRemoteViewMutateResult,
  CollectionRemoteViewItemsResult,
  CollectionViewI18nResult,
} from "@mulmoclaude/collection-plugin/vue";
import type {
  CollectionDetailResponse,
  CollectionsListResponse,
  CollectionOntologyResponse,
  ItemMutationResponse,
  FeedsListResponse,
} from "@mulmoclaude/core/collection";
import type { RegistryListResponse, RegistryImportResponse } from "@mulmoclaude/core/collection/registry";
import type { TranslateRequest, TranslateResponse } from "@mulmoclaude/core/translation/client";
import type { CollectionPushResult } from "../../common/collectionPush";
import type { CollectionRefreshResult } from "../../common/collectionRefresh";
import { buildCustomViewSrcdoc } from "../utils/customViewSrcdoc";
import { fetchJson, errorMessage, readErrorBody } from "../utils/fetchJson";
import { htmlPreviewUrl, remoteViewItemsQuery } from "./collectionUiRules";
import { useShortcuts } from "./useShortcuts";
import { useNotifications } from "./useNotifications";
import { collectionNotifiedSeverities } from "../utils/collectionNotified";
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
import { isRecord } from "../../common/isRecord";
import { withProject } from "./collectionProject";
import { activeCollectionNavSurface, activeCollectionProjectId } from "./collectionSurface";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

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

// The plugin package declares the generic — the collection package's `CollectionApiResult<T>` seam — so the PLUGIN chooses T and the host has to produce it from a body
// nothing has checked. Unprovable by construction, exactly like gui-chat-protocol's `dispatch<T>`
// (see the type-assertion allowlist in eslint.config.js). The claim is made HERE, at the seam,
// rather than hidden inside fetchJson where it would apply to every caller.
const asDeclared = <T>(raw: unknown): T => raw as T;

// Read helper: normalise fetch into the package's CollectionApiResult (the view
// treats `ok:false` with `status` 404 as not-found, any other failure as a skip).
/** The parts of the binding that do not depend on a project — and this is where that is PROVED
 *  rather than asserted: they are built outside `makeCollectionUi`, so they cannot read the
 *  scope even by accident, and a future entry that needs one has to move rather than quietly
 *  reach for the ambient project.
 *
 *  Navigation is the interesting member. It is per-SURFACE, not per project: a click inside a
 *  collections pane moves that pane, and a card's scope has nothing to say about where a link
 *  goes. */
type HostBinding = Parameters<typeof configureCollectionUi>[0];

const PROJECT_INDEPENDENT: Pick<
  HostBinding,
  | "confirm"
  | "localeTag"
  | "generalRoleId"
  | "personalRoleId"
  | "pinToggle"
  | "routeSlug"
  | "routeSelectedId"
  | "isFeedRoute"
  | "setSelectedId"
  | "gotoIndex"
  | "gotoDetail"
  | "navigateToRecord"
> = {
  confirm: (options) => Promise.resolve(window.confirm(options.message)),
  // MulmoTerminal has no host i18n; the plugin runs its own. Pick the browser's
  // base language, defaulting to English.
  localeTag: () => browserLocale(),
  generalRoleId: "general",
  personalRoleId: "personal",
  pinToggle: PinToggle,

  // ── navigation: no router — map onto useCollectionBrowse's view-state, which
  //    drives the full-screen browse overlay + the toolbar launcher.
  //
  //    …unless a surface has registered itself (collectionNavSurface.ts). A collections PANE
  //    beside a cell navigates INSIDE itself: routing it through the overlay's view-state would
  //    move the whole app on a click in a side pane, and two cells on different projects would
  //    share one "open collection". With no pane mounted the stack is empty and every line below
  //    is the browse call it always was. ──
  routeSlug: () => activeCollectionNavSurface()?.routeSlug() ?? browseRouteSlug(),
  routeSelectedId: () => activeCollectionNavSurface()?.routeSelectedId() ?? browseRouteSelectedId(),
  isFeedRoute: () => activeCollectionNavSurface()?.isFeedRoute() ?? browseIsFeedRoute(),
  setSelectedId: (itemId) => (activeCollectionNavSurface() ?? { setSelectedId: browseSetSelectedId }).setSelectedId(itemId),
  gotoIndex: (kind) => (activeCollectionNavSurface() ?? { gotoIndex: browseGotoIndex }).gotoIndex(kind),
  gotoDetail: (kind, slug) => (activeCollectionNavSurface() ?? { gotoDetail: browseGotoDetail }).gotoDetail(kind, slug),
  navigateToRecord: (targetSlug, recordId) =>
    (activeCollectionNavSurface() ?? { navigateToRecord: browseNavigateToRecord }).navigateToRecord(targetSlug, recordId),
};

/** The host binding, built for ONE project resolver.
 *
 *  A FACTORY because a chat card is not the pane. `configureCollectionUi` installs one global
 *  binding, and in a multi-root host that binding resolves every request against whatever project
 *  is ambient — the surface the user is looking at. A card, though, was made in a particular
 *  project and carries it (`PresentCollectionData.scope`, stamped by the host and never by the
 *  model), so the plugin asks for a binding of its own through `withScope` (collection-plugin
 *  >= 3.1.0). Without that, a card built in project A shows project B's records the moment the
 *  user moves the app — same slug, same title, different rows, nothing saying so.
 *
 *  Everything project-dependent goes through `scopedUrl` and `projectIdOf`, which is why they are
 *  parameters rather than lookups: there is then no way for one of them to keep reading the
 *  ambient project by accident. */
// A binding TABLE, not logic: one entry per capability the plugin declares, each a line or two.
// The length rule is right about functions and wrong about this — splitting the table into
// arbitrary groups moves entries away from the contract they implement. The parts that CAN stand
// alone (everything not carrying a project) already have, in PROJECT_INDEPENDENT above.
// eslint-disable-next-line max-lines-per-function
function makeCollectionUi(projectIdOf: () => string | null): HostBinding {
  const scopedUrl = (url: string) => withProject(url, projectIdOf());

  const apiGet = <T>(url: string): Promise<CollectionApiResult<T>> => fetchJson<T>(scopedUrl(url), asDeclared);

  const apiSend = <T>(method: "POST" | "PUT", url: string, body: unknown): Promise<CollectionApiResult<T>> =>
    fetchJson<T>(scopedUrl(url), asDeclared, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const apiPost = <T>(url: string, body: unknown) => apiSend<T>("POST", url, body);
  const apiPut = <T>(url: string, body: unknown) => apiSend<T>("PUT", url, body);

  // Delete → the view layer's CollectionMutationResult ({ ok } | { ok:false, error }).
  // On failure, surface the server's `{ error }` body (e.g. a delete-refusal reason
  // like "preset collections can't be deleted") instead of a bare status code.
  async function apiDelete(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetchWithTimeout(scopedUrl(url), { method: "DELETE" });
      if (res.ok) return { ok: true };
      return { ok: false, error: errorMessage(await readErrorBody(res), res.status) };
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
      const res = await fetchWithTimeout("/api/translation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      // `null` is the transport's documented miss — the caller falls back to the English source —
      // so a malformed body takes that path rather than handing the cache a bad shape.
      if (!isRecord(body) || !Array.isArray(body.translations) || !body.translations.every((line) => typeof line === "string")) return null;
      return { translations: body.translations };
    } catch {
      return null;
    }
  }

  const itemUrl = (slug: string, itemId: string) => `/api/collections/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}`;

  /** Browser URL for a ROOT-relative file path, via the raw-file route.
   *
   *  Carries the project like every other collection request: an `image` / `file` field is relative
   *  to the collection's own root, so without it a project's records resolve against the workspace —
   *  a missing image at best, another project's file at worst. */
  function rawFileUrl(value: unknown): string {
    return scopedUrl(`/api/files/raw?path=${encodeURIComponent(String(value))}`);
  }

  // The preview route (server/backends/html.ts → mountHtmlPreviewRoute) serves
  // artifacts/html/*.html with the sandboxed preview CSP so it renders in a new tab;
  // everything else falls back to the raw-file route. See htmlPreviewUrl.
  return {
    ...PROJECT_INDEPENDENT,
    // ── real (read side). The two paths below are MulmoClaude's response shapes on
    //    MulmoTerminal's own URLs — `/list` and `/:slug/detail`, where MulmoClaude has
    //    `GET /api/collections` and `GET /api/collections/:slug` (registry diverges too,
    //    see below). This file is the consumer of record for that; the divergence table
    //    and the reason are in docs/mulmoclaude-parity.md. ──
    fetchCollectionDetail: (slug) => apiGet<CollectionDetailResponse>(`/api/collections/${encodeURIComponent(slug)}/detail`),
    listCollections: () => apiGet<CollectionsListResponse>("/api/collections/list"),
    // Map tab: raw workspace-ontology entries; the plugin builds the graph
    // client-side via the shared buildOntologyGraph (optional binding — omitting
    // it would just hide the tab).
    fetchOntology: () => apiGet<CollectionOntologyResponse>("/api/collections/ontology"),

    // ── asset URLs → the raw workspace-file route (server/backends/files.ts).
    //    Mirrors MulmoClaude's resolveImageSrc: data: URIs pass through, everything
    //    else resolves to /api/files/raw?path=<workspace-relative>. fileRoutePath
    //    (in-app File Explorer nav) stays null — MulmoTerminal has no file explorer. ──
    imageSrc: (imageData) => (typeof imageData === "string" && imageData.startsWith("data:") ? imageData : rawFileUrl(imageData)),
    // The HTML preview route (`/artifacts/html/…`) is fixed to the workspace and takes no project,
    // so it is offered ONLY when the surface is the workspace. For a project it would either 404 or —
    // worse — render the workspace's file of the same path under that project's name; the raw-file
    // route is project-scoped, so a project's HTML asset goes there instead. It loses the preview
    // CSP treatment, which is the deliberate trade until that route learns about projects.
    fileAssetUrl: (value) => {
      if (typeof value !== "string" || value.length === 0) return null;
      const preview = projectIdOf() === null ? htmlPreviewUrl(value) : null;
      return preview ?? rawFileUrl(value);
    },
    fileRoutePath: () => null,

    // ── custom views (read-only): sandboxed-iframe HTML views over the shared
    //    workspace. Mint a scoped token, fetch the view HTML, and wrap it in a
    //    CSP-locked srcdoc with the token injected. ──
    mintViewToken: (slug, viewId) => apiPost<CollectionViewToken>(`/api/collections/${encodeURIComponent(slug)}/view-token`, { viewId }),
    fetchViewHtml: async (slug, viewId) => {
      try {
        const res = await fetchWithTimeout(scopedUrl(`/api/collections/${encodeURIComponent(slug)}/view-file?id=${encodeURIComponent(viewId)}`));
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

    // The view's translations, already locale-picked server-side (the host is the
    // picker, the iframe only ever sees the active locale's strings). The route
    // answers the documented "no i18n" shape ({ locale: "", dict: {} }) when the
    // view declares none, and the iframe's __MC_VIEW.t(key) then echoes keys.
    fetchViewI18n: (slug, viewId, locale) =>
      apiGet<CollectionViewI18nResult>(
        `/api/collections/${encodeURIComponent(slug)}/view-i18n?id=${encodeURIComponent(viewId)}&locale=${encodeURIComponent(locale)}`,
      ),

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
    // Typed against OUR response, not inferred from the plugin's expectation: this is the one
    // place the two shapes meet, so a server arm that stopped answering what the view reads is a
    // type error here rather than a field that silently arrives undefined.
    refreshCollection: (slug) => apiPost<CollectionRefreshResult>(`/api/collections/${encodeURIComponent(slug)}/refresh`, {}),
    // The write direction. Path matches MulmoClaude's `API_ROUTES.collections.calendarPush`.
    // A push that could not run still answers 200 with the reason in `errors`, which is what
    // the view shows beside the button (server/backends/calendarPush.ts).
    pushCalendarCollection: (slug) => apiPost<CollectionPushResult>(`/api/collections/${encodeURIComponent(slug)}/calendar-push`, {}),
    deleteView: (slug, viewId) => apiDelete(`/api/collections/${encodeURIComponent(slug)}/views/${encodeURIComponent(viewId)}`),
    listFeeds: () => apiGet<FeedsListResponse>("/api/feeds"),
    // ── Discover/registry tab: the shared @mulmoclaude/core registry engine, wired
    //    over /api/collections/registry/* (server/backends/collections.ts) — MulmoClaude
    //    serves the same engine at /api/collections-registry/*, one of the three known
    //    path divergences (docs/mulmoclaude-parity.md). ──
    listRegistry: () => apiGet<RegistryListResponse>("/api/collections/registry/list"),
    importRegistry: (author, slug, registry) => apiPost<RegistryImportResponse>("/api/collections/registry/import", { author, slug, registry }),

    // ── favorites: the shared useShortcuts store over /api/shortcuts. ──
    // ONLY EVER FROM THE WORKSPACE'S OWN LIST. This is data loss when it is wrong, and it was:
    // the pinned-shortcuts file is ONE workspace-global file (shared with MulmoClaude), while the
    // list the index just fetched is scoped to the surface's project (`withActiveProject`, applied
    // by `apiGet` above). Reconciling one against the other says "every collection the workspace
    // pinned is gone" whenever the pane is open on a project — and `reconcile` prunes and PERSISTS.
    //
    // That is not hypothetical. On 2026-08-09 opening the Collections pane on a project with one
    // collection deleted TWENTY-ONE pinned collections from `<workspace>/config/shortcuts.json`, in
    // both apps, with no undo and nothing on screen to say it had happened. The feeds survived only
    // because they are a different `kind`.
    //
    // So a project-scoped answer reconciles NOTHING. It is not "reconcile the project's pins
    // instead": pins are not per project, and pretending otherwise would delete the workspace's on
    // the way. If pins ever become per project, this is the line that has to learn about it — not
    // the store, which cannot see a scope from where it sits.
    reconcileShortcuts: (kind, live) => (projectIdOf() === null ? useShortcuts().reconcile(kind, live) : Promise.resolve()),
    unpin: (kind, slug) => useShortcuts().unpin(kind, slug),
    // ── chat: spawn a new terminal session seeded with the prompt and surface it
    //    (hidden=false → make it visible). Backs the index "create" button + the
    //    collection/record action buttons (Repair, etc.). MulmoTerminal has no roles,
    //    so `role` is ignored. ──
    startChat: (prompt) => void startCollectionChat(prompt, { hidden: false, project: projectIdOf() }),
    // Open a chat with the prompt prefilled as an editable DRAFT (not auto-sent) — the
    // new-collection template cards + custom views. The text is typed into claude's PTY
    // input box without an Enter (server: spawnBackgroundChat draft:true), so the user
    // reviews / edits / sends. `role` is ignored (MulmoTerminal has no roles).
    startNewChatDraft: (prompt) => void startCollectionChat(prompt, { hidden: false, draft: true, project: projectIdOf() }),
    // Which of this collection's records currently have a completion bell, and how
    // urgent — the Kanban view accents those cards. Read live: `active` is a ref, so
    // reading it inside the call registers the plugin's `computed` as a dependency and
    // the accents follow a watcher publishing or clearing without any extra plumbing.
    // `useNotifications()` is a module singleton and its init is idempotent, so calling
    // it per invocation costs nothing after the first (and keeps the pubsub subscription
    // out of this module's import).
    // Scoped to the SURFACE's project: the bell is app-wide and carries records from every
    // watched root, so a pane showing one project must not accent from another's.
    notifiedSeverities: (slug: string) => collectionNotifiedSeverities(useNotifications().active.value, slug, projectIdOf()),

    // ── one project, for a card that was made in one ──
    //
    // The plugin calls this with the scope stamped on the card's payload and uses the result for
    // that card's subtree only. A binding whose project is FIXED is the whole answer: it cannot
    // follow the pane, which is the bug — a card built in project A reading project B's records
    // the moment the user walks away from A.
    withScope: (scope: string) => makeCollectionUi(() => scope),

    // ── runtime translation: POST /api/translation (hidden-chat LLM). Enables the
    //    new-collection starter modal's localized cards; omitted ⇒ English fallback. ──
    translate: postTranslation,

    // ── Shadow-DOM modal target ── the innermost open Shadow root, or the body when none is open.
    //    The package types this `string | HTMLElement | ShadowRoot` as of 1.2.3, so the value this
    //    host has always passed no longer needs a cast to be expressible (mulmoclaude#2721).
    modalTeleportTarget: () => teleportStack[teleportStack.length - 1] ?? "body",
  };
}

// The GLOBAL binding: the project of whatever surface is being looked at, which is what every
// non-card caller means (the pane, the full-screen browser, the toolbar).
configureCollectionUi(makeCollectionUi(activeCollectionProjectId));
