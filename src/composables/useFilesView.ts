// Navigation seam for the full-screen file explorer + editor, a thin derivation over
// vue-router (mirrors usePrsView). The open view is the URL: /files?cwd=<project dir>.
// A terminal header's Files button opens it rooted at that terminal's directory.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

// The view to return to when the Files view closes rides on the history entry (router
// state), NOT a module variable — so entering /files via browser back/forward restores
// that entry's own origin instead of a stale one, and a fresh/direct load falls back to
// chat. Reopening while already in Files (root change, or the guarded-close revert)
// carries the same origin forward.
const originFromHistory = (): string => {
  const origin = router.options.history.state.returnPath;
  return typeof origin === "string" ? origin : "/";
};

/** Open the Files view rooted at `cwd` (the terminal's project dir). */
export function filesGotoIndex(cwd: string | null): void {
  const alreadyOpen = router.currentRoute.value.name === "files";
  const returnPath = alreadyOpen ? originFromHistory() : router.currentRoute.value.fullPath;
  router.push({ name: "files", query: cwd ? { cwd } : {}, state: { returnPath } });
}

/** Close the Files view → back to the view it was opened from. */
export function filesClose(): void {
  router.push(originFromHistory());
}

export function useFilesView(): { isOpen: ComputedRef<boolean>; cwd: ComputedRef<string | null>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "files"),
    // The project dir to browse — the ?cwd= query (a single string; arrays/absent => null).
    cwd: computed(() => {
      const q = router.currentRoute.value.query.cwd;
      return typeof q === "string" ? q : null;
    }),
    close: filesClose,
  };
}
