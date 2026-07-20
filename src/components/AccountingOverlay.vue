<script setup lang="ts">
// Full-screen accounting view — the no-router replacement for MulmoClaude's
// /accounting standalone page. Opened by the toolbar's account_balance button via
// useAccountingView. Renders <AccountingView/> inside a PluginFrame shadow root (same
// package styles + material-icons alias as the chat-canvas card), but with NO
// selectedResult: the View self-fetches its books on mount and auto-selects one (or
// shows the first-run "New book" form on an empty workspace). The host seams
// (apiCall / subscribe / locale) are wired once in composables/accountingUi.ts.
import { AccountingView } from "@mulmoclaude/accounting-plugin/vue";
import accountingCss from "@mulmoclaude/accounting-plugin/style.css?inline";
import PluginFrame from "./PluginFrame.vue";
import { useAccountingView } from "../composables/useAccountingView";
import { useEscapeToClose } from "../composables/useEscapeToClose";

const { isOpen, close } = useAccountingView();

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="accounting-overlay" role="region" aria-label="Accounting">
    <PluginFrame :css="accountingCss" height="100%">
      <AccountingView />
    </PluginFrame>
  </div>
</template>

<style scoped>
/* Fills the page BELOW the toolbar (40px) — the toolbar stays visible + clickable,
   so the user can switch back to Chat / Collections. Matches CollectionsBrowseOverlay. */
.accounting-overlay {
  position: fixed;
  top: 40px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  background: var(--bg-deep);
}
</style>
