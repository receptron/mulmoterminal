// View-state for the full-screen collection browser (the no-router replacement for
// MulmoClaude's /collections + /collections/:slug routes). The collection plugin's
// nav capabilities map onto this single reactive store (see collectionUi.ts), and
// CollectionsBrowseOverlay renders from it: the index, or a standalone CollectionView
// reading `routeSlug`/`routeSelectedId` back off the same store.
import { computed, reactive, type ComputedRef } from "vue";
import type { ShortcutKind } from "../types/shortcuts";

type BrowseView = { mode: "closed" } | { mode: "index"; kind: ShortcutKind } | { mode: "detail"; kind: ShortcutKind; slug: string; selectedId: string | null };

const state = reactive<{ view: BrowseView }>({ view: { mode: "closed" } });

// ── Mutators the binding's nav capabilities call (module-level so the global
//    binding can reach them without component context) ──

/** Open the index for a kind (collections / feeds). */
export function browseGotoIndex(kind: ShortcutKind): void {
  state.view = { mode: "index", kind };
}

/** Open one collection / feed's detail page. */
export function browseGotoDetail(kind: ShortcutKind, slug: string): void {
  state.view = { mode: "detail", kind, slug, selectedId: null };
}

/** A ref/embed hop into another collection, optionally deep-linking a record. */
export function browseNavigateToRecord(targetSlug: string, recordId?: string): void {
  state.view = { mode: "detail", kind: "collection", slug: targetSlug, selectedId: recordId ?? null };
}

/** Current detail slug (CollectionView reads this in standalone mode), or undefined. */
export function browseRouteSlug(): string | undefined {
  return state.view.mode === "detail" ? state.view.slug : undefined;
}

/** Current deep-linked record id, or undefined. */
export function browseRouteSelectedId(): string | undefined {
  return state.view.mode === "detail" ? (state.view.selectedId ?? undefined) : undefined;
}

/** True when the open page is the feeds (vs collections) family. */
export function browseIsFeedRoute(): boolean {
  return state.view.mode !== "closed" && state.view.kind === "feed";
}

/** Set/clear the open record (the modal deep-link), no history. */
export function browseSetSelectedId(itemId: string | null): void {
  if (state.view.mode === "detail") state.view.selectedId = itemId;
}

/** Close the browser overlay. */
export function browseClose(): void {
  state.view = { mode: "closed" };
}

export function useCollectionBrowse(): {
  view: ComputedRef<BrowseView>;
  isOpen: ComputedRef<boolean>;
  close: () => void;
} {
  return {
    view: computed(() => state.view),
    isOpen: computed(() => state.view.mode !== "closed"),
    close: browseClose,
  };
}
