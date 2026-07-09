<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { router } from "../router";
import NotificationBell from "./NotificationBell.vue";
import RemoteHostControl from "./RemoteHostControl.vue";
import { useShortcuts } from "../composables/useShortcuts";
import { useCollectionBrowse, browseGotoIndex, browseGotoDetail } from "../composables/useCollectionBrowse";
import { useAccountingView, accountingViewOpen } from "../composables/useAccountingView";
import { useWikiBrowse, wikiGotoIndex } from "../composables/useWikiBrowse";
import { usePrsView, prsGotoIndex } from "../composables/usePrsView";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import { startCollectionChat } from "../composables/useChatLauncher";
import type { Shortcut } from "../types/shortcuts";
import type { StatusCounts } from "./gridTabs";

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
const summaryTitle = computed(() => {
  const c = props.statusCounts;
  if (!c) return "";
  const parts: string[] = [];
  if (c.blocked) parts.push(`${c.blocked} need input`);
  if (c.done) parts.push(`${c.done} done (review)`);
  if (c.working) parts.push(`${c.working} working`);
  if (c.idle) parts.push(`${c.idle} idle`);
  return parts.join(" · ");
});
const hasSummary = computed(() => !!props.statusCounts && props.statusCounts.blocked + props.statusCounts.done + props.statusCounts.working > 0);
const { shortcuts } = useShortcuts();
const { view: browseView } = useCollectionBrowse();
const { isOpen: accountingOpen } = useAccountingView();
const { isOpen: wikiOpen } = useWikiBrowse();
const { isOpen: prsOpen } = usePrsView();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();

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
// Open a new Claude terminal prefilled (draft — not auto-sent) with the config skill, so the user
// can style a directory (or several) without hand-writing .mulmoterminal.json. The skill asks
// whether to configure this directory or a batch from their recent directories.
function configureAppearance(): void {
  void startCollectionChat("/mulmoterminal-config", { draft: true });
}
</script>

<template>
  <header class="toolbar">
    <span class="toolbar-title">MulmoTerminal</span>
    <nav class="launcher" aria-label="Views">
      <button type="button" class="launcher-btn" :class="{ active: chatActive }" title="Chat" aria-label="Chat" @click="showChat">
        <span class="material-symbols-outlined">chat</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: inGrid }" title="Grid (multiple terminals)" aria-label="Grid view" @click="showGrid">
        <span class="material-symbols-outlined">grid_view</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: collectionsActive }" title="Collections" aria-label="Collections" @click="showCollections">
        <span class="material-symbols-outlined">apps</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: accountingActive }" title="Accounting" aria-label="Accounting" @click="showAccounting">
        <span class="material-symbols-outlined">account_balance</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: prsActive }" title="Pull requests" aria-label="Pull requests" @click="showPrs">
        <span class="material-symbols-outlined">call_merge</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: wikiActive }" title="Wiki" aria-label="Wiki" @click="showWiki">
        <span class="material-symbols-outlined">menu_book</span>
      </button>
      <button
        v-for="s in shortcuts"
        :key="`${s.kind}:${s.slug}`"
        type="button"
        class="launcher-btn"
        :class="{ active: favActive(s) }"
        :title="s.title"
        :aria-label="s.title"
        @click="showFavorite(s)"
      >
        <span class="material-symbols-outlined">{{ s.icon || "bookmark" }}</span>
      </button>
      <button
        v-if="inGrid"
        type="button"
        class="launcher-btn"
        :class="{ active: addTerminalActive }"
        :title="addTerminalActive ? 'Cancel adding a terminal' : 'New terminal (overflows to a new tab when full)'"
        aria-label="New terminal"
        @click="emit('add-terminal')"
      >
        <span class="material-symbols-outlined">add</span>
      </button>
      <button
        v-if="inGrid"
        type="button"
        class="launcher-btn"
        :class="{ active: autoSort }"
        :title="
          autoSort
            ? 'Auto order: attention-first — needs-attention cells float up (click for manual ◀▶ ordering)'
            : 'Manual order: reorder cells with ◀▶ (click for auto attention-sort)'
        "
        aria-label="Toggle grid cell ordering"
        :aria-pressed="autoSort"
        @click="emit('toggle-sort')"
      >
        <span class="material-symbols-outlined">{{ autoSort ? "sort" : "swap_horiz" }}</span>
      </button>
      <span v-if="inGrid && hasSummary && statusCounts" class="grid-summary" role="img" :aria-label="`Grid status — ${summaryTitle}`" :title="summaryTitle">
        <span v-if="statusCounts.blocked" class="gs gs-blocked" aria-hidden="true">{{ statusCounts.blocked }}</span>
        <span v-if="statusCounts.done" class="gs gs-done" aria-hidden="true">{{ statusCounts.done }}</span>
        <span v-if="statusCounts.working" class="gs gs-working" aria-hidden="true">{{ statusCounts.working }}</span>
      </span>
    </nav>
    <NotificationBell class="toolbar-bell" />
    <RemoteHostControl />
    <button
      type="button"
      class="launcher-btn sound-toggle"
      :class="{ active: soundEnabled }"
      :title="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :aria-label="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :aria-pressed="soundEnabled"
      @click="toggleSound"
    >
      <span class="material-symbols-outlined">{{ soundEnabled ? "notifications_active" : "notifications_off" }}</span>
    </button>
    <button
      type="button"
      class="launcher-btn"
      title="Configure appearance (name, theme, colors, header buttons) — writes .mulmoterminal.json"
      aria-label="Configure appearance"
      @click="configureAppearance"
    >
      <span class="material-symbols-outlined">palette</span>
    </button>
    <button type="button" class="launcher-btn settings-btn" title="Settings" aria-label="Settings" @click="emit('settings')">
      <span class="material-symbols-outlined">settings</span>
    </button>
  </header>
</template>

<style scoped>
/* Top toolbar with the app title. */
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 16px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.toolbar-title {
  font-family: system-ui, sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  letter-spacing: 0.02em;
}

/* Toolbar tabs: Chat + Grid + Collections + Accounting + one per pinned favorite
   (+ the grid-only New terminal button). Icon-only. */
.launcher {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-left: 16px;
  min-width: 0;
  overflow-x: auto;
}
.launcher-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 30px;
  width: 30px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 6px;
  cursor: pointer;
}
.launcher-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.launcher-btn.active {
  background: var(--accent-bg);
  color: var(--on-accent);
}
/* Push the action buttons (bell, sound, settings) to the far right as a group. */
.toolbar-bell {
  margin-left: auto;
}
.launcher-btn .material-symbols-outlined {
  font-size: 19px;
  line-height: 1;
}

/* Grid-wide status tally: blocked (amber, needs you) · done (blue, review) · working
   (dim, just busy). A colored dot + count each; grouped after the grid controls. */
.grid-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.gs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  line-height: 1;
}
.gs::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.gs-blocked {
  color: var(--amber);
}
.gs-done {
  color: var(--accent);
}
.gs-working {
  color: var(--text-muted);
}
</style>
