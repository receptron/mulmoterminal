<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { router } from "../router";
import NotificationBell from "./NotificationBell.vue";
import RemoteHostControl from "./RemoteHostControl.vue";
import LauncherButton from "./LauncherButton.vue";
import { useShortcuts } from "../composables/useShortcuts";
import { useCollectionBrowse, browseGotoIndex, browseGotoDetail } from "../composables/useCollectionBrowse";
import { useAccountingView, accountingViewOpen } from "../composables/useAccountingView";
import { useWikiBrowse, wikiGotoIndex } from "../composables/useWikiBrowse";
import { usePrsView, prsGotoIndex } from "../composables/usePrsView";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import { useUpdateStatus } from "../composables/useUpdateStatus";
import type { Shortcut } from "../types/shortcuts";
import type { StatusCounts } from "./gridTabs";
import { gridStatusSummary } from "./gridTabs";

// The standard header, shared by the single (App.vue) and grid (GridView.vue) views so
// both show one identical toolbar. Every launcher button now just pushes a route — the
// surface (single shell vs grid, which overlay) is derived from the URL — so navigating
// to a single-view surface (collections / accounting) inherently leaves the grid. The
// active states re-derive from route.name (via the route-backed browse/accounting
// stores). Grid-only state (`addTerminalActive`, `autoSort`) is still passed in, and
// the grid-only actions (add-terminal / toggle-sort) and settings stay emits.
const props = defineProps<{ addTerminalActive?: boolean; autoSort?: boolean; statusCounts?: StatusCounts }>();
const emit = defineEmits<{ (e: "add-terminal" | "toggle-sort" | "settings"): void }>();

const route = useRoute();
// Grid-wide, at-a-glance tally: how many cells are blocked (need input) / done
// (review) / working, across every page. Shown only when something is running.
const summary = computed(() => gridStatusSummary(props.statusCounts));
const summaryTitle = computed(() => summary.value.title);
const hasSummary = computed(() => summary.value.show);
const { shortcuts } = useShortcuts();
const { view: browseView } = useCollectionBrowse();
const { isOpen: accountingOpen } = useAccountingView();
const { isOpen: wikiOpen } = useWikiBrowse();
const { isOpen: prsOpen } = usePrsView();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();
const { badge: updateBadge } = useUpdateStatus();

// The badge offers the upgrade command; copying beats making the user retype it. Clipboard
// can be unavailable (older browser, insecure context) — a failed copy is a no-op, the full
// command is still in the tooltip.
async function copyUpdateCommand(): Promise<void> {
  const command = updateBadge.value?.command;
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
  } catch {
    // best-effort — the tooltip still shows the command to copy by hand
  }
}

const inGrid = computed(() => route.name === "terminals");
const inSingle = computed(() => !inGrid.value);
const chatActive = computed(() => inSingle.value && browseView.value.mode === "closed" && !accountingOpen.value && !wikiOpen.value && !prsOpen.value);
const collectionsActive = computed(() => browseView.value.mode === "index" && browseView.value.kind === "collection");
const accountingActive = computed(() => accountingOpen.value);
const wikiActive = computed(() => wikiOpen.value);
const prsActive = computed(() => prsOpen.value);
function favActive(s: Shortcut): boolean {
  return browseView.value.mode === "detail" && browseView.value.kind === s.kind && browseView.value.slug === s.slug;
}

function showChat(): void {
  router.push("/");
}
function showGrid(): void {
  router.push("/terminals");
}
function showCollections(): void {
  browseGotoIndex("collection");
}
function showFavorite(s: Shortcut): void {
  browseGotoDetail(s.kind, s.slug);
}
function showAccounting(): void {
  accountingViewOpen();
}
function showWiki(): void {
  wikiGotoIndex();
}
function showPrs(): void {
  prsGotoIndex();
}
</script>

<template>
  <header class="flex h-10 flex-none items-center border-b border-border bg-panel px-4">
    <span class="font-sans text-[14px] font-semibold tracking-[0.02em] text-fg">MulmoTerminal</span>
    <nav class="ml-4 flex min-w-0 items-center gap-[3px] overflow-x-auto" aria-label="Views">
      <LauncherButton icon="chat" title="Chat" label="Chat" :active="chatActive" @click="showChat" />
      <LauncherButton icon="grid_view" title="Grid (multiple terminals)" label="Grid view" :active="inGrid" @click="showGrid" />
      <LauncherButton icon="apps" title="Collections" label="Collections" :active="collectionsActive" @click="showCollections" />
      <LauncherButton icon="account_balance" title="Accounting" label="Accounting" :active="accountingActive" @click="showAccounting" />
      <LauncherButton icon="call_merge" title="Pull requests" label="Pull requests" :active="prsActive" @click="showPrs" />
      <LauncherButton icon="menu_book" title="Wiki" label="Wiki" :active="wikiActive" @click="showWiki" />
      <LauncherButton
        v-for="s in shortcuts"
        :key="`${s.kind}:${s.slug}`"
        :icon="s.icon || 'bookmark'"
        :title="s.title"
        :label="s.title"
        :active="favActive(s)"
        @click="showFavorite(s)"
      />
      <LauncherButton
        v-if="inGrid"
        icon="add"
        :title="addTerminalActive ? 'Cancel adding a terminal' : 'New terminal (overflows to a new tab when full)'"
        label="New terminal"
        :active="addTerminalActive"
        @click="emit('add-terminal')"
      />
      <LauncherButton
        v-if="inGrid"
        :icon="autoSort ? 'sort' : 'swap_horiz'"
        :title="
          autoSort
            ? 'Auto order: attention-first — needs-attention cells float up (click for manual ◀▶ ordering)'
            : 'Manual order: reorder cells with ◀▶ (click for auto attention-sort)'
        "
        label="Toggle grid cell ordering"
        :active="autoSort"
        :aria-pressed="autoSort"
        @click="emit('toggle-sort')"
      />
      <span
        v-if="inGrid && hasSummary && statusCounts"
        class="ml-1.5 inline-flex flex-none items-center gap-2 border-l border-border pl-2.5"
        role="img"
        :aria-label="`Grid status — ${summaryTitle}`"
        :title="summaryTitle"
      >
        <span v-if="statusCounts.blocked" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-amber" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.blocked }}
        </span>
        <span v-if="statusCounts.done" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-accent" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.done }}
        </span>
        <span v-if="statusCounts.working" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-muted" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.working }}
        </span>
      </span>
    </nav>
    <NotificationBell class="ml-auto" />
    <RemoteHostControl />
    <button
      v-if="updateBadge"
      type="button"
      class="mr-1 inline-flex flex-none items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-[12px] leading-none text-accent hover:bg-selected"
      :title="updateBadge.command ? `${updateBadge.text} (click to copy)` : updateBadge.text"
      :aria-label="updateBadge.text"
      @click="copyUpdateCommand"
    >
      <span class="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">upgrade</span>
      Update
    </button>
    <LauncherButton
      :icon="soundEnabled ? 'notifications_active' : 'notifications_off'"
      :title="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :label="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :active="soundEnabled"
      :aria-pressed="soundEnabled"
      @click="toggleSound"
    />
    <LauncherButton icon="settings" title="Settings" label="Settings" @click="emit('settings')" />
  </header>
</template>
