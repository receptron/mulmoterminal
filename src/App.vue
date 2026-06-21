<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import Sidebar from "./components/Sidebar.vue";
import SessionTabBar from "./components/SessionTabBar.vue";
import TerminalView from "./components/Terminal.vue";
import GuiPanel from "./components/GuiPanel.vue";
import ToolsPane from "./components/ToolsPane.vue";
import CollectionsBrowseOverlay from "./components/CollectionsBrowseOverlay.vue";
import GridView from "./components/GridView.vue";
import SettingsModal from "./components/SettingsModal.vue";
import { useSessions, type Filter } from "./composables/useSessions";
import { useShortcuts } from "./composables/useShortcuts";
import { useCollectionBrowse, browseGotoIndex, browseGotoDetail, browseClose } from "./composables/useCollectionBrowse";
import { registerChatOpener } from "./composables/useChatLauncher";
import { useAppConfig } from "./composables/useAppConfig";
import type { Shortcut } from "./types/shortcuts";
import type { CwdPreset } from "./components/presets";

// View mode: the classic single-terminal view (default) or the multi-terminal
// grid. Persisted so a reload keeps the chosen view.
type ViewMode = "single" | "grid";
const viewMode = ref<ViewMode>(localStorage.getItem("view_mode") === "grid" ? "grid" : "single");
watch(viewMode, (v) => localStorage.setItem("view_mode", v));

// Shared launcher favorites (pinned collections / feeds), backing the toolbar.
const { shortcuts } = useShortcuts();
// Toolbar tabs reflect the browse view-state: Chat (overlay closed) | Collections
// (index open) | a favorite (its detail open).
const { view: browseView, isOpen: browseOpen } = useCollectionBrowse();
function favActive(s: Shortcut): boolean {
  return browseView.value.mode === "detail" && browseView.value.kind === s.kind && browseView.value.slug === s.slug;
}

const activeId = ref<string | null>(null);
const connectKey = ref(0);
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);

// Single source of truth for the session list, owned here (not inside the
// layout components) so toggling vertical/horizontal — which swaps Sidebar and
// SessionTabBar via v-if/v-else — never unmounts the store, refetches, or resets
// the filter. Both layouts render this same shared state.
const { sessions, loading, error, refresh } = useSessions();
const filter = ref<Filter>("all");

// Terminal column width (px), set by dragging the splitter between the terminal
// and the GUI panel; the GUI panel absorbs whatever is left. Persisted across
// reloads. The terminal's own ResizeObserver refits xterm's cols/rows as this
// changes, so a drag live-resizes the PTY.
const MIN_TERMINAL = 320;
const MIN_GUI = 360;
const terminalWidth = ref<number>(Number(localStorage.getItem("terminal_width")) || 560);

// Track the viewport so the splitter's max (and aria-valuemax) stays correct and
// the saved width re-clamps when the window shrinks.
const viewportWidth = ref(window.innerWidth);
const maxTerminal = computed(() => Math.max(MIN_TERMINAL, viewportWidth.value - MIN_GUI));

function clampWidth(w: number): number {
  return Math.max(MIN_TERMINAL, Math.min(w, maxTerminal.value));
}

function persistWidth() {
  localStorage.setItem("terminal_width", String(terminalWidth.value));
}

let stopDrag: (() => void) | null = null;
function startDrag(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = terminalWidth.value;
  const onMove = (ev: MouseEvent) => {
    terminalWidth.value = clampWidth(startW + (ev.clientX - startX));
  };
  const onUp = () => {
    persistWidth();
    stopDrag?.();
  };
  stopDrag = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    stopDrag = null;
  };
  // Suppress text selection / keep the resize cursor for the whole drag.
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// Keyboard resize for the separator (arrows nudge, Home/End jump to the limits)
// so the splitter is operable without a mouse.
function onSplitterKey(e: KeyboardEvent) {
  const STEP = 16;
  if (e.key === "ArrowLeft") terminalWidth.value = clampWidth(terminalWidth.value - STEP);
  else if (e.key === "ArrowRight") terminalWidth.value = clampWidth(terminalWidth.value + STEP);
  else if (e.key === "Home") terminalWidth.value = MIN_TERMINAL;
  else if (e.key === "End") terminalWidth.value = maxTerminal.value;
  else return;
  e.preventDefault();
  persistWidth();
}

function onViewportResize() {
  viewportWidth.value = window.innerWidth;
  terminalWidth.value = clampWidth(terminalWidth.value);
}
onMounted(() => window.addEventListener("resize", onViewportResize));

// Settings (directory presets + theme), shared with the grid view via useAppConfig
// and opened from the toolbar's gear button.
const { presets, saving: savingSettings, error: settingsError, loadConfig, savePresets: persistPresets } = useAppConfig();
const showSettings = ref(false);
onMounted(loadConfig);
async function savePresets(next: CwdPreset[]) {
  if (await persistPresets(next)) showSettings.value = false;
}
function closeSettings() {
  showSettings.value = false;
  settingsError.value = null;
}
onUnmounted(() => {
  stopDrag?.();
  window.removeEventListener("resize", onViewportResize);
});

// Session-history layout: "vertical" (left Sidebar) or "horizontal" (top
// SessionTabBar), mirroring mulmoclaude's two history layouts. Persisted across
// reloads like the tools pane.
type Layout = "vertical" | "horizontal";
const layout = ref<Layout>(localStorage.getItem("session_layout") === "horizontal" ? "horizontal" : "vertical");
watch(layout, (v) => localStorage.setItem("session_layout", v));
function toggleLayout() {
  layout.value = layout.value === "vertical" ? "horizontal" : "vertical";
}

// Tools pane visibility, persisted across reloads (mirrors MulmoClaude's
// right-sidebar toggle).
const showTools = ref(localStorage.getItem("tools_pane_visible") === "true");
watch(showTools, (v) => localStorage.setItem("tools_pane_visible", String(v)));
function toggleTools() {
  showTools.value = !showTools.value;
}

// GUI -> LLM: a plugin view (e.g. a submitted form) calls this with the user's
// response. Terminal.submitText types it into the PTY and submits it (text + a
// delayed CR, both pinned to the same socket). Returns whether it was delivered
// so the caller only locks/persists on success.
function sendTextMessage(text: string): boolean {
  return terminalRef.value?.submitText(text) ?? false;
}

function selectSession(id: string) {
  activeId.value = id;
  connectKey.value++;
}

// A collection action (startChat) spawned a new chat and wants it shown: close the
// browse overlay (if open) and select the session so the terminal displays it.
registerChatOpener((id: string) => {
  browseClose();
  selectSession(id);
});

function newSession() {
  activeId.value = null;
  connectKey.value++;
}

// The server reports the live session id (a generated id for new sessions).
// Adopt it as the active id so it highlights. The sidebar list itself is
// driven server-side: the server publishes the new session on the "sessions"
// channel, so no client-side reload is needed here.
function onSession(id: string) {
  activeId.value = id;
}
</script>

<template>
  <GridView v-if="viewMode === 'grid'" @exit="viewMode = 'single'" />
  <div v-else class="shell">
    <header class="toolbar">
      <span class="toolbar-title">MulmoTerminal</span>
      <nav class="launcher" aria-label="Views">
        <button type="button" class="launcher-btn" :class="{ active: !browseOpen }" title="Chat" aria-label="Chat" @click="browseClose">
          <span class="material-symbols-outlined">chat</span>
        </button>
        <button type="button" class="launcher-btn" title="Grid (multiple terminals)" aria-label="Grid view" @click="viewMode = 'grid'">
          <span class="material-symbols-outlined">grid_view</span>
        </button>
        <button
          type="button"
          class="launcher-btn"
          :class="{ active: browseView.mode === 'index' }"
          title="Collections"
          aria-label="Collections"
          @click="browseGotoIndex('collection')"
        >
          <span class="material-symbols-outlined">apps</span>
        </button>
        <button
          v-for="s in shortcuts"
          :key="`${s.kind}:${s.slug}`"
          type="button"
          class="launcher-btn"
          :class="{ active: favActive(s) }"
          :title="s.title"
          :aria-label="s.title"
          @click="browseGotoDetail(s.kind, s.slug)"
        >
          <span class="material-symbols-outlined">{{ s.icon || "bookmark" }}</span>
        </button>
      </nav>
      <button type="button" class="launcher-btn settings-btn" title="Settings" aria-label="Settings" @click="showSettings = true">
        <span class="material-symbols-outlined">settings</span>
      </button>
    </header>
    <div :class="['app', layout === 'horizontal' ? 'app-horizontal' : 'app-vertical']">
      <Sidebar
        v-if="layout === 'vertical'"
        v-model:filter="filter"
        :sessions="sessions"
        :loading="loading"
        :error="error"
        :active-id="activeId"
        @select="selectSession"
        @new="newSession"
        @toggle-layout="toggleLayout"
        @refresh="refresh"
      />
      <SessionTabBar
        v-else
        v-model:filter="filter"
        :sessions="sessions"
        :active-id="activeId"
        @select="selectSession"
        @new="newSession"
        @toggle-layout="toggleLayout"
        @refresh="refresh"
      />
      <div class="main">
        <TerminalView
          ref="terminalRef"
          class="terminal-pane"
          :style="{ flex: `0 0 ${terminalWidth}px` }"
          :session-id="activeId"
          :connect-key="connectKey"
          @session="onSession"
        />
        <div
          class="splitter"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize terminal"
          :aria-valuenow="terminalWidth"
          :aria-valuemin="MIN_TERMINAL"
          :aria-valuemax="maxTerminal"
          title="Drag (or use arrow keys) to resize the terminal"
          @mousedown="startDrag"
          @keydown="onSplitterKey"
        />
        <GuiPanel :session-id="activeId" :send-text-message="sendTextMessage" :tools-open="showTools" @toggle-tools="toggleTools" />
        <ToolsPane v-if="showTools" :session-id="activeId" @close="toggleTools" />
      </div>
    </div>
    <!-- Full-screen collection browser; shown when the launcher / an index card / a
         ref hop opens it (driven by useCollectionBrowse). -->
    <CollectionsBrowseOverlay />
    <SettingsModal v-if="showSettings" :presets="presets" :saving="savingSettings" :error="settingsError" @save="savePresets" @close="closeSettings" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

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

/* Toolbar tabs: Chat + Collections + one per pinned favorite. Icon-only. */
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
.launcher-btn .material-symbols-outlined {
  font-size: 19px;
  line-height: 1;
}
/* Pin the gear to the far right of the toolbar. */
.settings-btn {
  margin-left: auto;
}

.app {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

/* Vertical: Sidebar | [ Terminal | GuiPanel ]. */
.app-vertical {
  flex-direction: row;
}

/* Horizontal: SessionTabBar stacked above [ Terminal | GuiPanel ]. */
.app-horizontal {
  flex-direction: column;
}

/* [ Terminal | GuiPanel ] — the unified two-panel view in miniature. Bounded to
   the leftover height (full viewport in vertical mode, viewport minus the tab
   bar in horizontal mode) so the panes fill it exactly instead of overflowing
   under `.app { overflow: hidden }`. Panes size to height:100% of this. */
.main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* Terminal pane: fixed flex-basis (set inline from terminalWidth); the GUI
   panel beside it absorbs the remaining width. */
.terminal-pane {
  min-width: 0;
}

/* Draggable divider between the terminal and the GUI panel. */
.splitter {
  flex: 0 0 5px;
  cursor: col-resize;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}
.splitter:hover {
  background: var(--bg-hover);
}
.splitter:focus-visible {
  outline: none;
  background: var(--accent);
}
</style>
