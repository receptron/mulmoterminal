// Navigation seam for the full-screen blueprint overlay — same shape as useRoomsView. The open BUILD
// is the URL, so a build waiting for its owner's approval can be linked to and reloaded.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";
import { RUN_ID_RE } from "../../common/blueprint/run";

export function blueprintsViewOpen(runId?: string): void {
  const to = runId && RUN_ID_RE.test(runId) ? { name: "blueprintRun", params: { run: runId } } : { name: "blueprints" };
  void router.push({ ...to, state: overlayOriginState() });
}

export function blueprintsViewClose(): void {
  void router.push(overlayReturnPath());
}

/** Moves INSIDE the overlay with `replace`, so closing returns to where it was opened from. */
export function blueprintsViewSelect(runId: string | null): void {
  const to = runId ? { name: "blueprintRun", params: { run: runId } } : { name: "blueprints" };
  void router.replace({ ...to, state: overlayOriginState() });
}

export function blueprintsViewMarket(): void {
  void router.replace({ name: "blueprintMarket", state: overlayOriginState() });
}

const ROUTE_NAMES = new Set(["blueprints", "blueprintRun", "blueprintMarket"]);

export function useBlueprintsView(): { isOpen: ComputedRef<boolean>; runId: ComputedRef<string | null>; inMarket: ComputedRef<boolean>; close: () => void } {
  const route = computed(() => router.currentRoute.value);
  return {
    isOpen: computed(() => ROUTE_NAMES.has(String(route.value.name))),
    inMarket: computed(() => route.value.name === "blueprintMarket"),
    runId: computed(() => {
      const raw = route.value.params.run;
      return typeof raw === "string" && RUN_ID_RE.test(raw) ? raw : null;
    }),
    close: blueprintsViewClose,
  };
}
