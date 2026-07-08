// Navigation seam for the cross-repo PR list view — a thin derivation over vue-router,
// mirroring useWikiBrowse / useAccountingView. The open view is entirely the URL:
// /prs = the PR list. The toolbar button and App's overlay read these.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

// Where to return when the PR view closes. Captured when opening from a normal view
// (the grid or chat) so Close restores it instead of always dropping to chat.
let returnPath = "/";

/** Open the cross-repo PR list. */
export function prsGotoIndex(): void {
  if (router.currentRoute.value.name !== "prs") {
    returnPath = router.currentRoute.value.fullPath;
  }
  router.push("/prs");
}

/** Close the PR view → back to the view it was opened from. */
export function prsClose(): void {
  router.push(returnPath);
}

export function usePrsView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "prs"),
    close: prsClose,
  };
}
