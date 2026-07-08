// Navigation seam for the full-screen file explorer + editor, a thin derivation over
// vue-router (mirrors usePrsView). The open view is the URL: /files?cwd=<project dir>.
// A terminal header's Files button opens it rooted at that terminal's directory.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

// Where to return when the Files view closes. Captured when opening from a normal
// view (the grid or chat) so Close restores it instead of always dropping to chat.
// Reopening while already in Files (changing the root dir, or reverting a guarded
// close) must NOT overwrite it, or the origin would be lost.
let returnPath = "/";

/** Open the Files view rooted at `cwd` (the terminal's project dir). */
export function filesGotoIndex(cwd: string | null): void {
  if (router.currentRoute.value.name !== "files") {
    returnPath = router.currentRoute.value.fullPath;
  }
  router.push({ name: "files", query: cwd ? { cwd } : {} });
}

/** Close the Files view → back to the view it was opened from. */
export function filesClose(): void {
  router.push(returnPath);
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
