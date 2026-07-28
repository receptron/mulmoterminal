// Navigation seam for the decision log — a thin derivation over vue-router, mirroring
// useFilesView. The open view is the URL: /decisions[?cwd=<project dir>].
//
// `cwd` is optional because the two ways in know different things: the toolbar is global and lets
// the view fall back to the server's workspace, while a terminal header button (open.view =
// "decisions") scopes it to that cell's directory.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

/** Open the decision log, optionally rooted at a specific project dir. */
export function decisionsGotoIndex(cwd: string | null): void {
  router.push({ name: "decisions", query: cwd ? { cwd } : {}, state: overlayOriginState() });
}

/** Close it → back to the view it was opened from. */
export function decisionsClose(): void {
  router.push(overlayReturnPath());
}

export function useDecisionsView(): { isOpen: ComputedRef<boolean>; cwd: ComputedRef<string | null>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "decisions"),
    cwd: computed(() => {
      const value = router.currentRoute.value.query.cwd;
      return typeof value === "string" && value ? value : null;
    }),
    close: decisionsClose,
  };
}
