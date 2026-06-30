// Navigation seam for the full-screen accounting overlay — the /accounting route
// (the MulmoTerminal equivalent of MulmoClaude's /accounting page). Originally a
// hand-rolled reactive { open } store; now a thin derivation over vue-router, with
// the exported function names unchanged so the toolbar + overlay come along
// untouched. The toolbar's account_balance button opens it; AccountingOverlay
// renders when isOpen.
//
// The overlay mounts <AccountingView/> STANDALONE (no tool result): the View
// self-fetches its book list on mount and auto-selects a book — or shows the
// first-run "New book" form on an empty workspace — so no openBook payload is needed.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

/** Open the accounting overlay. */
export function accountingViewOpen(): void {
  router.push("/accounting");
}

/** Close the accounting overlay → back to chat. */
export function accountingViewClose(): void {
  router.push("/");
}

export function useAccountingView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "accounting"),
    close: accountingViewClose,
  };
}
