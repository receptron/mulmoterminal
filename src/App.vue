<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import Sidebar from "./components/Sidebar.vue";
import SessionTabBar from "./components/SessionTabBar.vue";
import TerminalView from "./components/Terminal.vue";
import GuiPanel from "./components/GuiPanel.vue";
import ToolsPane from "./components/ToolsPane.vue";
import CollectionsBrowseOverlay from "./components/CollectionsBrowseOverlay.vue";
import AccountingOverlay from "./components/AccountingOverlay.vue";
import GridView from "./components/GridView.vue";
import SettingsModal from "./components/SettingsModal.vue";
import AppToolbar from "./components/AppToolbar.vue";
import { useSessions, type Filter } from "./composables/useSessions";
import { browseClose } from "./composables/useCollectionBrowse";
import { registerChatOpener } from "./composables/useChatLauncher";
import { useAppConfig } from "./composables/useAppConfig";
import { usePendingScript, type PendingCommand } from "./composables/usePendingScript";
import { useSoundEnabled } from "./composables/useSoundEnabled";
import { useAttentionSound } from "./composables/useAttentionSound";
import type { CwdPreset } from "./components/presets";

// View mode: the classic single-terminal view (default) or the multi-terminal
// grid. Persisted so a reload keeps the chosen view.
type ViewMode = "single" | "grid";
const viewMode = ref<ViewMode>(localStorage.getItem("view_mode") === "grid" ? "grid" : "single");
watch(viewMode, (v) => localStorage.setItem("view_mode", v));

// A script picked from the terminal header's Run menu runs in the grid (command
// cells live only there): stash it and switch to the grid, which picks it up.
const { requestRun } = usePendingScript();
function onRunScript(command: PendingCommand) {
  requestRun(command);
  viewMode.value = "grid";
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

// Beep when any session needs attention (waiting) — across the single and grid
// views, including terminals on background grid pages. Listens to the "sessions"
// activity stream directly (same source as the cell status), independent of the
// fetched list above.
const { enabled: soundEnabled } = useSoundEnabled();
// soundFile is a shared singleton in useAppConfig, so the player here sees changes
// made from either view's settings modal (and loadConfig below hydrates it).
const { soundFile } = useAppConfig();
useAttentionSound(soundEnabled, soundFile);

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
const { presets, saving: savingSettings, error: settingsError, loadConfig, savePresets: persistPresets, saveSound } = useAppConfig();
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
    <AppToolbar :view-mode="viewMode" @go-grid="viewMode = 'grid'" @settings="showSettings = true" />
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
          run-menu
          @session="onSession"
          @run="onRunScript"
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
    <!-- Full-screen accounting view; opened by the toolbar's account_balance button
         (driven by useAccountingView). Mutually exclusive with the browser above. -->
    <AccountingOverlay />
    <SettingsModal
      v-if="showSettings"
      :presets="presets"
      :sound-file="soundFile"
      :saving="savingSettings"
      :error="settingsError"
      @save="savePresets"
      @update-sound="saveSound"
      @close="closeSettings"
    />
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
