// Navigation seam for the full-screen collection browser. Originally a hand-rolled
// reactive store (the no-router stand-in for MulmoClaude's /collections +
// /collections/:slug); now a thin derivation over vue-router. The exported function
// names are unchanged, so call sites (collectionUi's nav capabilities, the toolbar,
// the browse overlay) come along untouched.
//
// The open collection/feed PAGE is the URL; only the open RECORD (a modal) stays
// in-memory — records are intentionally not addressable (no history entry).
import { computed, reactive, watch, type ComputedRef } from "vue";
import type { ShortcutKind } from "../../common/shortcuts";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";
import { collectionChatKey } from "./collectionChatKey";

type BrowseView = { mode: "closed" } | { mode: "index"; kind: ShortcutKind } | { mode: "detail"; kind: ShortcutKind; slug: string; selectedId: string | null };

// The only retained state: which record's modal is open, KEYED by the exact detail
// PAGE it belongs to (so /collections/foo and /feeds/foo never share a record, even
// with overlapping slugs). Records are intentionally not addressable — opening one
// never touches the URL.
const state = reactive<{ pageKey: string | null; selectedId: string | null }>({ pageKey: null, selectedId: null });

/** What "the same page" means for a record: the path AND the project.
 *
 *  THE PROJECT IS PART OF THE KEY, not decoration. Two projects' `/collections/tasks` are the
 *  same path, so keying on the path alone lets a record modal survive a project change made by
 *  browser Back/Forward or a hand-typed URL — the one navigation this module does not route
 *  itself. With a `primaryKey` schema the ids are drawn from the data, so the surviving id
 *  frequently EXISTS in the project navigated to, and the modal then shows a different record
 *  of the same name rather than failing visibly.
 *
 *  A newline separates the two because a path cannot contain one, so no path-and-project pair
 *  can spell another. */
function pageKeyFor(path: string, projectId: string | null): string {
  return `${path}\n${projectId ?? ""}`;
}

function currentPageKey(): string {
  return pageKeyFor(router.currentRoute.value.path, browseRouteProjectId());
}

function clearRecord(): void {
  state.pageKey = null;
  state.selectedId = null;
}

// Leaving a detail page — by ANY means: a toolbar push, browser Back/Forward, or a
// hand-typed URL — drops the open record, honoring the "records are not history"
// contract (a later return to the same URL must not revive a stale modal). A single
// SYNC watcher on the page key is the one place this happens, so individual nav callers
// (showChat / showGrid / showAccounting / …) don't each have to remember to clear.
// flush:"sync" fires the clear during navigation, strictly before router.push's
// promise resolves — so browseNavigateToRecord's post-push .then re-set always wins.
//
// It watches the KEY rather than the path so a project switch that keeps the path counts as
// leaving the page, which it is.
watch(currentPageKey, () => clearRecord(), { flush: "sync" });

// The open record for the page currently on screen (null once the page no longer matches).
function recordOnCurrentPage(): string | null {
  return state.pageKey !== null && state.pageKey === currentPageKey() ? state.selectedId : null;
}

function pathFor(kind: ShortcutKind, slug?: string): string {
  const base = kind === "feed" ? "/feeds" : "/collections";
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

/** The project the open page is showing, or null for the workspace.
 *
 *  IT LIVES IN THE URL, unlike the open record: a project is not a modal, it is which
 *  collections the page is listing, and a link that arrives without it lands on a different
 *  collection of the same name. That is exactly what a completion bell from a project sends —
 *  the deep link it carries is the only way this overlay is ever asked for a non-workspace
 *  project (server/backends/collectionNotifierAdapter.ts). An OPAQUE ID, never a path. */
export function browseRouteProjectId(): string | null {
  const project = router.currentRoute.value.query.project;
  return typeof project === "string" && project.length > 0 ? project : null;
}

/** The collection on screen RIGHT NOW, as a filing key for its chats.
 *
 *  Read when a chat is STARTED, not when its spawn comes back: the spawn is awaited, and someone
 *  who moves to another collection while it is in flight would otherwise have that chat filed where
 *  they landed rather than where they asked for it (Codex, PR #2002). */
export function currentCollectionChatKey(): string | null {
  return collectionChatKey(currentView(), browseRouteProjectId());
}

/** The COLLECTION on screen right now, or null.
 *
 *  Narrower than the filing key above, and the two answer different questions: the key files a
 *  chat under wherever it was started (the collections INDEX is a place too, and a feed is one),
 *  while this names a collection that actually exists to be resolved and drawn. A feed detail and
 *  an index both answer null here. */
export function currentCollectionSlug(): string | null {
  const view = currentView();
  return view.mode === "detail" && view.kind === "collection" ? view.slug : null;
}

/** The query a push should carry: the project asked for, else the one already open — so a ref
 *  hop or an index click made INSIDE a project stays in it instead of silently falling back to
 *  the workspace halfway through a browse. */
function queryFor(projectId?: string | null): Record<string, string> {
  const project = projectId === undefined ? browseRouteProjectId() : projectId;
  return project ? { project } : {};
}

/** Open the index for a kind (collections / feeds). */
export function browseGotoIndex(kind: ShortcutKind, projectId?: string | null): void {
  clearRecord();
  void router.push({ path: pathFor(kind), query: queryFor(projectId), state: overlayOriginState() });
}

/** Open one collection / feed's detail page. */
export function browseGotoDetail(kind: ShortcutKind, slug: string, projectId?: string | null): void {
  clearRecord();
  void router.push({ path: pathFor(kind, slug), query: queryFor(projectId), state: overlayOriginState() });
}

/** A ref/embed hop into another collection, optionally deep-linking a record.
 *
 *  `projectId` is passed by the ONE caller that knows a project other than the open one: a
 *  completion bell, whose record may live in a project this page is not showing. A ref hop
 *  passes nothing and stays where it is — a reference is resolved within its own root. */
export function browseNavigateToRecord(targetSlug: string, recordId?: string, projectId?: string | null): void {
  // Ref hops are collection→collection. The sync path watcher clears the record
  // during the push, so (re)apply the record AFTER navigation settles on the target
  // path. Always assign — a hop to the CURRENT page (no path change → no watcher
  // fire) with no recordId must still close any stale modal, not reuse it.
  const targetPath = pathFor("collection", targetSlug);
  void router.push({ path: targetPath, query: queryFor(projectId), state: overlayOriginState() }).then(() => {
    state.pageKey = recordId ? currentPageKey() : null;
    state.selectedId = recordId ?? null;
  });
}

/** Current detail slug (CollectionView reads this in standalone mode), or undefined. */
export function browseRouteSlug(): string | undefined {
  const slug = router.currentRoute.value.params.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
}

/** Current deep-linked record id, or undefined. */
export function browseRouteSelectedId(): string | undefined {
  return recordOnCurrentPage() ?? undefined;
}

/** True when the open page is the feeds (vs collections) family. */
export function browseIsFeedRoute(): boolean {
  const name = router.currentRoute.value.name;
  return name === "feeds" || name === "feedDetail";
}

/** Set/clear the open record (the modal deep-link) on the current page, no history. */
export function browseSetSelectedId(itemId: string | null): void {
  state.pageKey = itemId ? currentPageKey() : null;
  state.selectedId = itemId;
}

/** Close the browser overlay → back to the view it was opened from. */
export function browseClose(): void {
  clearRecord();
  void router.push(overlayReturnPath());
}

/** Derive the legacy BrowseView shape from the current route + record state. */
function currentView(): BrowseView {
  const slug = browseRouteSlug();
  switch (router.currentRoute.value.name) {
    case "collections":
      return { mode: "index", kind: "collection" };
    case "feeds":
      return { mode: "index", kind: "feed" };
    case "collectionDetail":
      return slug ? { mode: "detail", kind: "collection", slug, selectedId: recordOnCurrentPage() } : { mode: "index", kind: "collection" };
    case "feedDetail":
      return slug ? { mode: "detail", kind: "feed", slug, selectedId: recordOnCurrentPage() } : { mode: "index", kind: "feed" };
    default:
      return { mode: "closed" };
  }
}

export function useCollectionBrowse(): {
  view: ComputedRef<BrowseView>;
  isOpen: ComputedRef<boolean>;
  close: () => void;
} {
  return {
    view: computed(currentView),
    isOpen: computed(() => currentView().mode !== "closed"),
    close: browseClose,
  };
}
