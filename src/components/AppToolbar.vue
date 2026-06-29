<script setup lang="ts">
import { computed } from "vue";
import NotificationBell from "./NotificationBell.vue";
import { useShortcuts } from "../composables/useShortcuts";
import { useCollectionBrowse, browseGotoIndex, browseGotoDetail, browseClose } from "../composables/useCollectionBrowse";
import { useAccountingView, accountingViewOpen, accountingViewClose } from "../composables/useAccountingView";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import type { Shortcut } from "../types/shortcuts";

// The standard header, shared by the single (App.vue) and grid (GridView.vue) views so
// both show one identical toolbar. The launcher targets single-view surfaces (the
// collection browser / accounting overlay live in App.vue), so from the grid view those
// buttons set the global browse/accounting state and emit `go-single` to switch back —
// the overlay is then already open. Grid-only state (`addTerminalActive`, `autoSort`)
// is passed in.
type ViewMode = "single" | "grid";

const props = defineProps<{ viewMode: ViewMode; addTerminalActive?: boolean; autoSort?: boolean }>();
const emit = defineEmits<{ (e: "go-single" | "go-grid" | "add-terminal" | "toggle-sort" | "settings"): void }>();

const { shortcuts } = useShortcuts();
const { view: browseView } = useCollectionBrowse();
const { isOpen: accountingOpen } = useAccountingView();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();

// Highlight reflects the single-view surfaces, so in the grid view only the Grid button
// reads as active.
const inSingle = computed(() => props.viewMode === "single");
const chatActive = computed(() => inSingle.value && browseView.value.mode === "closed" && !accountingOpen.value);
const collectionsActive = computed(() => inSingle.value && browseView.value.mode === "index");
const accountingActive = computed(() => inSingle.value && accountingOpen.value);
function favActive(s: Shortcut): boolean {
  return inSingle.value && browseView.value.mode === "detail" && browseView.value.kind === s.kind && browseView.value.slug === s.slug;
}

function showChat(): void {
  browseClose();
  accountingViewClose();
  emit("go-single");
}
function showCollections(): void {
  accountingViewClose();
  browseGotoIndex("collection");
  emit("go-single");
}
function showFavorite(s: Shortcut): void {
  accountingViewClose();
  browseGotoDetail(s.kind, s.slug);
  emit("go-single");
}
function showAccounting(): void {
  browseClose();
  accountingViewOpen();
  emit("go-single");
}
</script>

<template>
  <header class="toolbar">
    <span class="toolbar-title">MulmoTerminal</span>
    <nav class="launcher" aria-label="Views">
      <button type="button" class="launcher-btn" :class="{ active: chatActive }" title="Chat" aria-label="Chat" @click="showChat">
        <span class="material-symbols-outlined">chat</span>
      </button>
      <button
        type="button"
        class="launcher-btn"
        :class="{ active: viewMode === 'grid' }"
        title="Grid (multiple terminals)"
        aria-label="Grid view"
        @click="emit('go-grid')"
      >
        <span class="material-symbols-outlined">grid_view</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: collectionsActive }" title="Collections" aria-label="Collections" @click="showCollections">
        <span class="material-symbols-outlined">apps</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: accountingActive }" title="Accounting" aria-label="Accounting" @click="showAccounting">
        <span class="material-symbols-outlined">account_balance</span>
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
        v-if="viewMode === 'grid'"
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
        v-if="viewMode === 'grid'"
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
    </nav>
    <NotificationBell class="toolbar-bell" />
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
</style>
