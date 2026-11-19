// Navigation seam for the full-screen Library (#3329) — the same shape as useSkillsView.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

/** Opens the Library, on one conversation when `session` names it (a cell's History menu). */
export function libraryViewOpen(session?: string): void {
  void router.push({ name: "library", query: session ? { session } : {}, state: overlayOriginState() });
}

/** The conversation the Library was opened on, from its URL. */
export function libraryRequestedSession(): string | null {
  const session = router.currentRoute.value.query.session;
  return typeof session === "string" && session !== "" ? session : null;
}

export function libraryViewClose(): void {
  void router.push(overlayReturnPath());
}

export function useLibraryView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "library"),
    close: libraryViewClose,
  };
}
