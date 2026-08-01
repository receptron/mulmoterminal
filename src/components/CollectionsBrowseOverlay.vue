<script setup lang="ts">
// Full-screen collection browser — the no-router replacement for MulmoClaude's
// /collections + /collections/:slug pages. Driven by useCollectionBrowse: shows the
// CollectionsIndexView (index) or a standalone CollectionView (detail), rendered
// inside a PluginFrame shadow root with the collection styles, exactly like the chat
// card. Opened by the toolbar launcher / index cards / ref hops via the binding's nav
// capabilities (collectionUi.ts).
import { onBeforeUnmount, ref, watch } from "vue";
import { CollectionsIndexView, CollectionView, FeedsView } from "@mulmoclaude/collection-plugin/vue";
import PluginFrame from "./PluginFrame.vue";
import { collectionShadowCss } from "../collectionShadowCss";
import { useCollectionBrowse, browseGotoDetail } from "../composables/useCollectionBrowse";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import { pushCollectionTeleportTarget, popCollectionTeleportTarget } from "../composables/collectionUi";
import { useShortcuts } from "../composables/useShortcuts";
import type { Shortcut } from "../../common/shortcuts";

// Navigation is the toolbar's job (the Chat tab closes this; Collections / favorite
// tabs switch what it shows), so the overlay itself carries no chrome — it just fills
// the page below the toolbar.
const { view, isOpen, close } = useCollectionBrowse();

// The pinned favourites, on the row this overlay already had. They used to live in the app
// toolbar and only in the single view, so they were about to be deleted along with it — and this
// is where they belong anyway: a favourite IS a collection or a feed, so the row that carries them
// is the one you are already looking at when you want one.
//
// The row previously held the Claude / Codex / Antigravity picker for chats started from here
// (owner's call to replace it). `launchAgent` still decides which agent a collection action
// spawns; it is now whatever was last chosen elsewhere, persisted in localStorage.
const { shortcuts } = useShortcuts();
const favActive = (s: Shortcut): boolean => view.value.mode === "detail" && view.value.kind === s.kind && view.value.slug === s.slug;

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
    <!-- Pinned favourites. Hidden entirely when there are none, rather than leaving an empty rule
         across the top of the view. -->
    <div v-if="shortcuts.length" class="flex flex-none items-center gap-2.5 border-b border-border px-3 py-1.5 font-sans" role="navigation" aria-label="Pinned">
      <span class="text-[11px] uppercase tracking-[0.05em] text-dim">Pinned</span>
      <div class="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        <button
          v-for="s in shortcuts"
          :key="`${s.kind}:${s.slug}`"
          type="button"
          class="flex flex-none cursor-pointer items-center gap-1 rounded-[5px] border-0 px-2.5 py-[3px] font-sans text-[12px] font-medium"
          :class="favActive(s) ? 'bg-elevated text-fg' : 'bg-transparent text-dim hover:text-fg'"
          :aria-current="favActive(s) ? 'page' : undefined"
          :title="s.title"
          @click="browseGotoDetail(s.kind, s.slug)"
        >
          <span class="material-symbols-outlined text-[15px]">{{ s.icon || "bookmark" }}</span>
          <span class="truncate">{{ s.title }}</span>
        </button>
      </div>
    </div>
    <div class="min-h-0 flex-1">
      <PluginFrame :css="collectionShadowCss" height="100%">
        <div ref="probe" style="height: 100%">
          <!-- The FEEDS index is its own component. CollectionsIndexView lists collections and
               explicitly filters feeds OUT (`source !== "feed"`), so rendering it for /feeds showed
               the collection list under the Feeds button — the plugin ships FeedsView for exactly
               this and nothing here was using it. Detail is shared: CollectionView asks the binding
               (`isFeedRoute`) which kind it is showing. -->
          <FeedsView v-if="view.mode === 'index' && view.kind === 'feed'" />
          <CollectionsIndexView v-else-if="view.mode === 'index'" />
          <CollectionView v-else-if="view.mode === 'detail'" />
        </div>
      </PluginFrame>
    </div>
  </div>
</template>
