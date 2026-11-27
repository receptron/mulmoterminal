// One key between the screen last opened over the terminals and the view it was opened from: the
// screens are kept while closed, so going back shows them as they were left.
import { router } from "../router";
import { lastPlaceIn } from "./overlayLastPlace";
import { OVERLAY_ROUTES, overlayOriginState, overlayReturnPath } from "./overlayOrigin";

const lastScreen = lastPlaceIn(OVERLAY_ROUTES);

/** Leaves the open screen, or goes back to the last one. False when no screen was opened yet. */
export function toggleLastScreen(): boolean {
  if (OVERLAY_ROUTES.has(String(router.currentRoute.value.name))) {
    void router.push(overlayReturnPath());
    return true;
  }
  const last = lastScreen();
  if (last === null) return false;
  // A `path` holding a query would be pushed without it, and the Library keeps its conversation there.
  const { path, query, hash } = router.resolve(last);
  void router.push({ path, query, hash, state: overlayOriginState() });
  return true;
}
