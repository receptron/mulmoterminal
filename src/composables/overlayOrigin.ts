// Where a full-screen overlay (collections / wiki / PRs / accounting / files) returns when it
// closes: the view it was opened from, rather than a fixed screen (#886).
//
// The origin rides the HISTORY ENTRY, not a module variable — so entering an overlay via
// browser back/forward restores that entry's own origin instead of a stale one, and a fresh
// or direct load has none and falls back. Navigating INSIDE an overlay carries the same
// origin forward.
import { router } from "../router";

// The routes that render as a full-screen panel ON TOP of a view. Every one of them starts
// below the header (`top-10`), so the header stays visible while they are open — which means
// the view underneath must not change when one opens.
// The CONTENT surfaces: the workspace's own data, as opposed to the terminals. Entered through the
// Collections button, which then reveals its siblings — so this set is what "am I in there?"
// means, and it lives beside OVERLAY_ROUTES because the two lists must not drift. PRs is the one
// overlay that is NOT content: it is about work under supervision, and belongs with the grid.
export const CONTENT_ROUTES = new Set([
  "accounting",
  "files",
  "wiki",
  "wikiPage",
  "wikiGraph",
  "wikiLint",
  "collections",
  "collectionDetail",
  "feeds",
  "feedDetail",
]);

const OVERLAY_ROUTES = new Set([...CONTENT_ROUTES, "prs"]);

/** The route an open overlay should return to. */
export function overlayReturnPath(): string {
  const origin = router.options.history.state.returnPath;
  // Resolved from the NAME rather than written as "/": that path is the default-view entry
  // and lands on the grid (#883). A string is what comes back, because this same value is
  // stored in history state, which the check above reads back as a string.
  //
  // The grid, not chat. This is the answer for an overlay with NO recorded origin — a direct load
  // of /collections, a link, a restored tab — and the grid is where "/" already sends those. It
  // also decides what renders BEHIND such an overlay (see viewIsGrid, and App.vue's shell), so
  // pointing it at the view that is being removed would put the single view back on screen.
  return typeof origin === "string" ? origin : router.resolve({ name: "terminals" }).fullPath;
}

/** The `state` to attach to an overlay's push: the view to come back to.
 *
 *  Capture the current screen only when it is NOT itself an overlay. That covers three cases
 *  with one rule — entering from a view, moving around inside one overlay (index → detail, a
 *  tab, a ref hop), and hopping straight from one overlay to another (grid → PRs → Worklog),
 *  which an "am I already in MY overlay?" test gets wrong: it records the PR list as the
 *  place Worklog should return to, and the header follows it back to the wrong view. */
export function overlayOriginState(): { returnPath: string } {
  const here = router.currentRoute.value;
  return { returnPath: OVERLAY_ROUTES.has(String(here.name)) ? overlayReturnPath() : here.fullPath };
}
