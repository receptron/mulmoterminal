<script setup lang="ts">
// Full-screen collection browser — the no-router replacement for MulmoClaude's
// /collections + /collections/:slug pages. Driven by useCollectionBrowse: shows the
// CollectionsIndexView (index) or a standalone CollectionView (detail), rendered
// inside a PluginFrame shadow root with the collection styles, exactly like the chat
// card. Opened by the toolbar launcher / index cards / ref hops via the binding's nav
// capabilities (collectionUi.ts).
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CollectionsIndexView, CollectionView } from "@mulmoclaude/collection-plugin/vue";
import PluginFrame from "./PluginFrame.vue";
import { collectionShadowCss } from "../collectionShadowCss";
import { useCollectionBrowse } from "../composables/useCollectionBrowse";
import { pushCollectionTeleportTarget, popCollectionTeleportTarget } from "../composables/collectionUi";
import { launchAgent } from "../composables/useChatLauncher";

// Navigation is the toolbar's job (the Chat tab closes this; Collections / favorite
// tabs switch what it shows), so the overlay itself carries no chrome — it just fills
// the page below the toolbar.
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
onBeforeUnmount(() => {
  unregister();
  window.removeEventListener("keydown", onKeydown);
});

// Close on Escape (window-level so it fires without focusing the overlay).
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && isOpen.value) close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="isOpen" class="browse-overlay" role="region" aria-label="Collections">
    <div class="browse-bar">
      <span class="browse-bar-label">Launch with</span>
      <div class="agent-toggle" role="radiogroup" aria-label="Launch agent">
        <button
          type="button"
          class="agent-btn"
          :class="{ active: launchAgent === 'claude' }"
          role="radio"
          :aria-checked="launchAgent === 'claude'"
          @click="launchAgent = 'claude'"
        >
          Claude
        </button>
        <button
          type="button"
          class="agent-btn"
          :class="{ active: launchAgent === 'codex' }"
          role="radio"
          :aria-checked="launchAgent === 'codex'"
          @click="launchAgent = 'codex'"
        >
          Codex
        </button>
      </div>
    </div>
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
/* Fills the page BELOW the toolbar (40px) — the toolbar stays visible + clickable. */
.browse-overlay {
  position: fixed;
  top: 40px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
}

/* A thin bar picking which agent a collection action / chat launches. */
.browse-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-family: system-ui, sans-serif;
}
.browse-bar-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
}
.agent-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-panel);
}
.agent-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font:
    500 12px system-ui,
    sans-serif;
  padding: 3px 14px;
  border-radius: 5px;
}
.agent-btn:hover {
  color: var(--text);
}
.agent-btn.active {
  background: var(--bg-elevated);
  color: var(--text);
}

.browse-body {
  flex: 1;
  min-height: 0;
}
</style>
