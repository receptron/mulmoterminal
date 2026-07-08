// Navigation seam for the cross-repo PR list view — a thin derivation over vue-router,
// mirroring useWikiBrowse / useAccountingView. The open view is entirely the URL:
// /prs = the PR list. The toolbar button and App's overlay read these.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

// The view to return to when the PR view closes rides on the history entry (router
// state), NOT a module variable — so entering /prs via browser back/forward restores
// that entry's own origin instead of a stale one, and a fresh/direct load falls back
// to chat.
const originFromHistory = (): string => {
  const origin = router.options.history.state.returnPath;
  return typeof origin === "string" ? origin : "/";
};

/** Open the cross-repo PR list, remembering the view it was opened from. */
export function prsGotoIndex(): void {
  const alreadyOpen = router.currentRoute.value.name === "prs";
  const returnPath = alreadyOpen ? originFromHistory() : router.currentRoute.value.fullPath;
  router.push({ path: "/prs", state: { returnPath } });
}

/** Close the PR view → back to the view it was opened from. */
export function prsClose(): void {
  router.push(originFromHistory());
}

export function usePrsView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "prs"),
    close: prsClose,
  };
}
