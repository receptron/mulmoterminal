// View-state for the full-screen accounting overlay — the no-router equivalent of
// MulmoClaude's /accounting standalone page. The toolbar's account_balance button
// (App.vue) opens it; AccountingOverlay renders from this single reactive store.
// Module-level state so the toolbar and the overlay share one source of truth without
// prop drilling (mirrors useCollectionBrowse).
//
// The overlay mounts <AccountingView/> STANDALONE (no tool result): the View
// self-fetches its book list on mount and auto-selects a book — or shows the
// first-run "New book" form on an empty workspace — so no openBook payload is needed.
import { computed, reactive, type ComputedRef } from "vue";

const state = reactive<{ open: boolean }>({ open: false });

/** Open the accounting overlay. */
export function accountingViewOpen(): void {
  state.open = true;
}

/** Close the accounting overlay. */
export function accountingViewClose(): void {
  state.open = false;
}

export function useAccountingView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(() => state.open),
    close: accountingViewClose,
  };
}
