// Navigation seam for the full-screen collection browser. Originally a hand-rolled
// reactive store (the no-router stand-in for MulmoClaude's /collections +
// /collections/:slug); now a thin derivation over vue-router. The exported function
// names are unchanged, so call sites (collectionUi's nav capabilities, the toolbar,
// the browse overlay) come along untouched.
//
// The open collection/feed PAGE is the URL; only the open RECORD (a modal) stays
// in-memory — records are intentionally not addressable (no history entry).
import { computed, reactive, watch, type ComputedRef } from "vue";
import type { ShortcutKind } from "../types/shortcuts";
import { router } from "../router";

type BrowseView = { mode: "closed" } | { mode: "index"; kind: ShortcutKind } | { mode: "detail"; kind: ShortcutKind; slug: string; selectedId: string | null };

// The only retained state: which record's modal is open, KEYED by the exact detail
// PATH it belongs to (so /collections/foo and /feeds/foo never share a record, even
// with overlapping slugs). Records are intentionally not addressable — opening one
// never touches the URL.
const state = reactive<{ recordPath: string | null; selectedId: string | null }>({ recordPath: null, selectedId: null });

function clearRecord(): void {
  state.recordPath = null;
  state.selectedId = null;
}

// Leaving a detail page — by ANY means: a toolbar push, browser Back/Forward, or a
// hand-typed URL — drops the open record, honoring the "records are not history"
// contract (a later return to the same URL must not revive a stale modal). A single
// SYNC watcher on the path is the one place this happens, so individual nav callers
// (showChat / showGrid / showAccounting / …) don't each have to remember to clear.
// flush:"sync" fires the clear during navigation, strictly before router.push's
// promise resolves — so browseNavigateToRecord's post-push .then re-set always wins.
watch(
  () => router.currentRoute.value.path,
  () => clearRecord(),
  { flush: "sync" },
);

// The open record for the page currently on screen (null once the path no longer matches).
function recordOnCurrentPage(): string | null {
  return state.recordPath !== null && state.recordPath === router.currentRoute.value.path ? state.selectedId : null;
}

function pathFor(kind: ShortcutKind, slug?: string): string {
  const base = kind === "feed" ? "/feeds" : "/collections";
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

/** Open the index for a kind (collections / feeds). */
export function browseGotoIndex(kind: ShortcutKind): void {
  clearRecord();
  router.push(pathFor(kind));
}

/** Open one collection / feed's detail page. */
export function browseGotoDetail(kind: ShortcutKind, slug: string): void {
  clearRecord();
  router.push(pathFor(kind, slug));
}

/** A ref/embed hop into another collection, optionally deep-linking a record. */
export function browseNavigateToRecord(targetSlug: string, recordId?: string): void {
  // Ref hops are collection→collection. The sync path watcher clears the record
  // during the push, so re-apply it AFTER navigation settles on the target path.
  const targetPath = pathFor("collection", targetSlug);
  router.push(targetPath).then(() => {
    if (recordId) {
      state.recordPath = targetPath;
      state.selectedId = recordId;
    }
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
  state.recordPath = itemId ? router.currentRoute.value.path : null;
  state.selectedId = itemId;
}

/** Close the browser overlay → back to chat. */
export function browseClose(): void {
  clearRecord();
  router.push("/");
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
