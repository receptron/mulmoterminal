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
import { useCollectionBrowse } from "../composables/useCollectionBrowse";
import { useEscapeToClose } from "../composables/useEscapeToClose";
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
onBeforeUnmount(unregister);

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Collections">
    <div class="flex flex-none items-center gap-2.5 border-b border-border px-3 py-1.5 font-sans">
      <span class="text-[11px] uppercase tracking-[0.05em] text-dim">Launch with</span>
      <div class="inline-flex gap-0.5 rounded-[7px] border border-border bg-panel p-0.5" role="radiogroup" aria-label="Launch agent">
        <button
          type="button"
          class="cursor-pointer rounded-[5px] border-0 px-3.5 py-[3px] font-sans text-[12px] font-medium"
          :class="launchAgent === 'claude' ? 'bg-elevated text-fg' : 'bg-transparent text-dim hover:text-fg'"
          role="radio"
          :aria-checked="launchAgent === 'claude'"
          @click="launchAgent = 'claude'"
        >
          Claude
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-[5px] border-0 px-3.5 py-[3px] font-sans text-[12px] font-medium"
          :class="launchAgent === 'codex' ? 'bg-elevated text-fg' : 'bg-transparent text-dim hover:text-fg'"
          role="radio"
          :aria-checked="launchAgent === 'codex'"
          @click="launchAgent = 'codex'"
        >
          Codex
        </button>
      </div>
    </div>
    <div class="min-h-0 flex-1">
      <PluginFrame :css="collectionShadowCss" height="100%">
        <div ref="probe" style="height: 100%">
          <CollectionsIndexView v-if="view.mode === 'index'" />
          <CollectionView v-else-if="view.mode === 'detail'" />
        </div>
      </PluginFrame>
    </div>
  </div>
</template>
