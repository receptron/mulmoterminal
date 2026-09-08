<script setup lang="ts">
// Full-screen collection browser — the no-router replacement for MulmoClaude's
// /collections + /collections/:slug pages. Driven by useCollectionBrowse: shows the
// CollectionsIndexView (index) or a standalone CollectionView (detail), rendered
// inside a PluginFrame shadow root with the collection styles, exactly like the chat
// card. Opened by the toolbar launcher / index cards / ref hops via the binding's nav
// capabilities (collectionUi.ts).
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { CollectionsIndexView, CollectionView, FeedsView } from "@mulmoclaude/collection-plugin/vue";
import PluginFrame from "./PluginFrame.vue";
import CollectionChatPane from "./CollectionChatPane.vue";
import { collectionShadowCss } from "../collectionShadowCss";
import { useCollectionBrowse, browseGotoDetail } from "../composables/useCollectionBrowse";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import { useCollectionTeleportTarget } from "../composables/useCollectionTeleportTarget";
import { pushCollectionSurface, popCollectionSurface, type CollectionSurface } from "../composables/collectionSurface";
import {
  browseGotoIndex,
  browseNavigateToRecord,
  browseRouteProjectId,
  browseRouteSlug,
  browseRouteSelectedId,
  browseIsFeedRoute,
  browseSetSelectedId,
} from "../composables/useCollectionBrowse";
import { useShortcuts } from "../composables/useShortcuts";
import type { Shortcut } from "../../common/shortcuts";
import LaunchAgentPicker from "./LaunchAgentPicker.vue";
import ChatModalAgentPicker from "./ChatModalAgentPicker.vue";

// Navigation is the toolbar's job (the Chat tab closes this; Collections / favorite
// tabs switch what it shows), so the overlay itself carries no chrome — it just fills
// the page below the toolbar.
const { view, isOpen, close } = useCollectionBrowse();

// The pinned favourites, on the row this overlay already had. They used to live in the app
// toolbar and only in the single view, so they were about to be deleted along with it — and this
// is where they belong anyway: a favourite IS a collection or a feed, so the row that carries them
// is the one you are already looking at when you want one.
//
// They share the row with the launch-agent dropdown. `launchAgent` decides which agent every
// collection-started chat spawns (useChatLauncher), and after the old three-button toggle made
// way for the pins nothing in the UI wrote it — the choice sat frozen at whatever localStorage
// last held, Claude for anyone who never used the toggle. A dropdown fits beside the pins where
// the toggle did not, so both fit on the one row now.
const { shortcuts } = useShortcuts();
const favActive = (s: Shortcut): boolean => view.value.mode === "detail" && view.value.kind === s.kind && view.value.slug === s.slug;

// The probe sits inside the PluginFrame shadow, which is what lets the composable resolve
// this overlay's shadow root as the record modal's teleport target.
const probe = ref<HTMLElement>();
useCollectionTeleportTarget(probe);

// The overlay registers itself as a SURFACE while it is open, and that is not symmetry for its
// own sake: a Collections pane may still be mounted behind it (panes are per cell and do not
// unmount when an overlay covers them). Without this the pane stayed the top surface, so clicks
// in the visible overlay navigated the hidden pane and the overlay's own requests carried the
// pane's project. Registering restores the invariant the stack is for — the innermost VISIBLE
// surface owns scope and navigation.
//
// The project comes from the ROUTE, and null — the workspace — is what every way of opening this
// overlay still produces. Only one thing puts a project in that URL: a completion bell whose
// record lives in one (server/backends/collectionNotifierAdapter.ts). A GETTER because the stack
// is read imperatively at the moment a request is built, so the surface must answer for the page
// on screen NOW rather than for the one it was pushed on.
//
// Its nav delegates to `useCollectionBrowse`, i.e. the router, which is what the binding fell
// through to before surfaces existed.
const overlaySurface: CollectionSurface = {
  get projectId() {
    return browseRouteProjectId();
  },
  // Full-screen: it covers the pane slot, so it outranks a canvas or Collections pane however
  // recently that mounted — a tool result can auto-reveal a canvas BEHIND this overlay.
  layer: "screen",
  nav: {
    routeSlug: browseRouteSlug,
    routeSelectedId: browseRouteSelectedId,
    isFeedRoute: browseIsFeedRoute,
    setSelectedId: browseSetSelectedId,
    gotoIndex: browseGotoIndex,
    gotoDetail: browseGotoDetail,
    navigateToRecord: browseNavigateToRecord,
  },
};
watch(
  isOpen,
  (open) => {
    if (open) pushCollectionSurface(overlaySurface);
    else popCollectionSurface(overlaySurface);
  },
  { immediate: true },
);
onBeforeUnmount(() => popCollectionSurface(overlaySurface));

// Remount key for the plugin views — see the template.
const projectKey = computed(() => browseRouteProjectId() ?? "workspace");

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Collections">
    <!-- Pinned favourites and the launch-agent picker. The row used to hide itself when nothing
         was pinned; the picker always has something to show, so the row is always there now. -->
    <div class="flex flex-none items-center gap-2.5 border-b border-border px-3 py-1.5 font-sans">
      <template v-if="shortcuts.length">
        <span class="text-[11px] uppercase tracking-[0.05em] text-dim">Pinned</span>
        <div class="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="navigation" aria-label="Pinned">
          <!-- ICON ONLY. The name still reaches a screen reader through aria-label, and the pointer
               through title — dropping the visible text is a density decision, not a decision to
               ship an unlabelled control. -->
          <button
            v-for="s in shortcuts"
            :key="`${s.kind}:${s.slug}`"
            type="button"
            class="flex flex-none cursor-pointer items-center justify-center rounded-[5px] border-0 px-1.5 py-[3px] text-[15px] leading-none"
            :class="favActive(s) ? 'bg-elevated text-fg' : 'bg-transparent text-dim hover:text-fg'"
            :aria-current="favActive(s) ? 'page' : undefined"
            :aria-label="s.title"
            :title="s.title"
            @click="browseGotoDetail(s.kind, s.slug)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ s.icon || "bookmark" }}</span>
          </button>
        </div>
      </template>
      <div class="ml-auto flex flex-none items-center gap-2">
        <!-- ALWAYS here, unlike the same picker in a cell's Collections pane. This is where the
             choice is made, and a control that hides itself while it holds its default leaves no
             way to leave that default. -->
        <LaunchAgentPicker label="Launch with" description="Agent that chats started from collections run" />
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
          <!-- KEYED BY PROJECT. The views fetch on mount and follow the route's SLUG; switching
               project changes only the query, so without this a bell for another project's
               `tasks` while the workspace's `tasks` is open would re-scope the requests and
               render none of them. -->
          <FeedsView v-if="view.mode === 'index' && view.kind === 'feed'" :key="projectKey" />
          <CollectionsIndexView v-else-if="view.mode === 'index'" :key="projectKey" />
          <!-- The plugin's "Start chat" modal covers the whole page (`fixed inset-0` +
               `backdrop-blur-sm`), so the toolbar picker above is blurred out at exactly the
               moment the button is pressed — which is why the plugin grew a footer slot for us
               (#1945, @mulmoclaude/collection-plugin 4.6.0). The plugin withholds it on the
               embedded path, where the seed goes into a session that is already running. -->
          <CollectionView v-else-if="view.mode === 'detail'" :key="projectKey">
            <template #chat-modal-options><ChatModalAgentPicker /></template>
          </CollectionView>
        </div>
      </PluginFrame>
    </div>
    <!-- A chat started from a card runs HERE rather than taking the screen to the grid (#2001).
         The pane claims that placement only while this overlay is open, and hands the session on
         to the grid when it lets go — so nothing is stranded and nothing is owned twice. -->
    <CollectionChatPane />
  </div>
</template>
