// Navigation seam for the full-screen Library (#3329) — the same shape as useSkillsView.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

export function libraryViewOpen(): void {
  void router.push({ name: "library", state: overlayOriginState() });
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
