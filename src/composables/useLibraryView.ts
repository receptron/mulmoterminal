// Navigation seam for the full-screen Library (#3329) — the same shape as useSkillsView.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

/** A conversation the Library is asked to open on: its session id, and the project it ran in. */
export interface LibraryRequest {
  session: string;
  cwd: string | null;
}

/** Opens the Library, on one conversation when `request` names it (a cell's History menu). */
export function libraryViewOpen(request?: LibraryRequest): void {
  const query = request ? { session: request.session, ...(request.cwd ? { cwd: request.cwd } : {}) } : {};
  void router.push({ name: "library", query, state: overlayOriginState() });
}

/** The conversation the Library was opened on, from its URL. */
export function libraryRequested(): LibraryRequest | null {
  const { session, cwd } = router.currentRoute.value.query;
  if (typeof session !== "string" || session === "") return null;
  return { session, cwd: typeof cwd === "string" && cwd !== "" ? cwd : null };
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
