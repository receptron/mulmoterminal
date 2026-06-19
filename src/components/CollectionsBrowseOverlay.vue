<script setup lang="ts">
// Full-screen collection browser — the no-router replacement for MulmoClaude's
// /collections + /collections/:slug pages. Driven by useCollectionBrowse: shows the
// CollectionsIndexView (index) or a standalone CollectionView (detail), rendered
// inside a PluginFrame shadow root with the collection styles, exactly like the chat
// card. Opened by the toolbar launcher / index cards / ref hops via the binding's nav
// capabilities (collectionUi.ts).
import { onBeforeUnmount, ref, watch } from "vue";
import { CollectionsIndexView, CollectionView } from "@mulmoclaude/collection-plugin/vue";
import PluginFrame from "./PluginFrame.vue";
import { collectionShadowCss } from "../collectionShadowCss";
import { useCollectionBrowse, browseGotoIndex } from "../composables/useCollectionBrowse";
import { pushCollectionTeleportTarget, popCollectionTeleportTarget } from "../composables/collectionUi";

const { view, isOpen, close } = useCollectionBrowse();

// Register this overlay's shadow root as the record-modal teleport target while a
// detail page is open (the package's CollectionRecordModal teleports there; the
// global binding can't otherwise know which shadow root to use). Same getRootNode()
// trick as CollectionCardView — the probe sits inside the PluginFrame shadow.
const probe = ref<HTMLElement>();
let registered: HTMLElement | ShadowRoot | null = null;
function unregister(): void {
  if (registered) {
    popCollectionTeleportTarget(registered);
    registered = null;
  }
}
watch(probe, (el) => {
  unregister();
  const root = el?.getRootNode();
  if (root instanceof ShadowRoot) {
    registered = root;
    pushCollectionTeleportTarget(root);
  }
});
onBeforeUnmount(unregister);

function backToIndex(): void {
  if (view.value.mode === "detail") browseGotoIndex(view.value.kind);
}

// Close on Escape for keyboard users.
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}
</script>

<template>
  <div v-if="isOpen" class="browse-overlay" role="dialog" aria-modal="true" aria-label="Collections" tabindex="-1" @keydown="onKeydown">
    <header class="browse-chrome">
      <button v-if="view.mode === 'detail'" type="button" class="chrome-btn" title="Back to index" aria-label="Back to index" @click="backToIndex">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <span class="chrome-title">{{ view.mode === "detail" && view.kind === "feed" ? "Feeds" : "Collections" }}</span>
      <button type="button" class="chrome-btn close" title="Close" aria-label="Close" @click="close">
        <span class="material-symbols-outlined">close</span>
      </button>
    </header>
    <div class="browse-body">
      <PluginFrame :css="collectionShadowCss" height="100%">
        <div ref="probe" style="height: 100%">
          <CollectionsIndexView v-if="view.mode === 'index'" />
          <CollectionView v-else-if="view.mode === 'detail'" />
        </div>
      </PluginFrame>
    </div>
  </div>
</template>

<style scoped>
.browse-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: #0b1020;
}
.browse-chrome {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #16213e;
  color: #e0e0e0;
  border-bottom: 1px solid #2a2a4e;
  font-family: system-ui, sans-serif;
}
.chrome-title {
  font-weight: 600;
  font-size: 14px;
}
.chrome-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border: none;
  background: transparent;
  color: #b9c2e0;
  border-radius: 6px;
  cursor: pointer;
}
.chrome-btn:hover {
  color: #fff;
  background: #243056;
}
.chrome-btn.close {
  margin-left: auto;
}
.browse-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px;
}
</style>
