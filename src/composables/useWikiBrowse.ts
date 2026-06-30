// Navigation seam for the read-only wiki browser — a thin derivation over vue-router,
// mirroring useCollectionBrowse / useAccountingView. The open VIEW is entirely the URL
// (no retained state): /wiki = index, /wiki/pages/:slug = a page, /wiki/graph = graph,
// /wiki/lint = lint. The exported nav helpers are what the toolbar, the overlay tabs,
// and in-page [[link]] / backlink / graph-node clicks call.
//
// Read-only: there is no record/modal state to retain (that was Collections'
// complication), so this is purely view-state + push helpers.
import { computed, type ComputedRef } from "vue";
import { isSafeWikiSlug } from "@mulmoclaude/core/wiki";
import { router } from "../router";

export type WikiView = { mode: "closed" } | { mode: "index" } | { mode: "page"; slug: string } | { mode: "graph" } | { mode: "lint" };

/** Open the wiki index (the page catalog). */
export function wikiGotoIndex(): void {
  router.push("/wiki");
}

/** Open one page by slug. Unsafe slugs are coerced to the index rather than pushing a
 *  route the API would reject — the guard mirrors the server's isSafeWikiSlug. */
export function wikiGotoPage(slug: string): void {
  if (!isSafeWikiSlug(slug)) {
    router.push("/wiki");
    return;
  }
  router.push(`/wiki/pages/${encodeURIComponent(slug)}`);
}

/** Open the link graph. */
export function wikiGotoGraph(): void {
  router.push("/wiki/graph");
}

/** Open the lint report. */
export function wikiGotoLint(): void {
  router.push("/wiki/lint");
}

/** Close the wiki overlay → back to chat. */
export function wikiClose(): void {
  router.push("/");
}

/** Current page slug when on a page route, else undefined. */
export function wikiRouteSlug(): string | undefined {
  const slug = router.currentRoute.value.params.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
}

/** Derive the view from the current route. */
function currentView(): WikiView {
  switch (router.currentRoute.value.name) {
    case "wiki":
      return { mode: "index" };
    case "wikiPage": {
      const slug = wikiRouteSlug();
      return slug ? { mode: "page", slug } : { mode: "index" };
    }
    case "wikiGraph":
      return { mode: "graph" };
    case "wikiLint":
      return { mode: "lint" };
    default:
      return { mode: "closed" };
  }
}

export function useWikiBrowse(): {
  view: ComputedRef<WikiView>;
  isOpen: ComputedRef<boolean>;
  close: () => void;
} {
  return {
    view: computed(currentView),
    isOpen: computed(() => currentView().mode !== "closed"),
    close: wikiClose,
  };
}
