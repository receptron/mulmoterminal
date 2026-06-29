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
import { useDirConfig } from "./composables/useDirConfig";
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
const { defaultCwd, presets, saving: savingSettings, error: settingsError, loadConfig, savePresets: persistPresets, saveSound } = useAppConfig();
// Drive the single view's dir overrides off the dir the terminal ACTUALLY runs in
// (reported by the server, which may resolve/fall back), not the static default — so
// the badge/theme/colors always track the active session. Falls back to the default
// until the terminal reports its cwd.
const activeCwd = ref<string | null>(null);
const effectiveCwd = computed(() => activeCwd.value ?? defaultCwd.value);
const { config: singleDirConfig } = useDirConfig(effectiveCwd);
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
  if (id !== activeId.value) clearDraftHint(); // switching away from a preparing draft
  activeId.value = id;
  connectKey.value++;
}

// A transient "preparing your draft…" hint, shown over the terminal while a draft
// chat boots and its text is typed into claude's input box (a few seconds), so the
// brief delay doesn't look like nothing happened. Auto-dismisses.
const DRAFT_HINT_EN = "Preparing your draft — it'll appear in the input box in a moment. Review it, then press Enter to send.";
const draftHint = ref(false);
const draftHintText = ref(DRAFT_HINT_EN);
let draftHintTimer: ReturnType<typeof setTimeout> | undefined;
// Localize the hint via the same runtime translation route the collection UX uses
// (English fallback while it resolves / on failure). The host has no static i18n, so
// this keeps the one new user-facing string from being English-only. Translated once
// per session; the server cache makes it instant thereafter.
async function localizeDraftHint() {
  const locale = (navigator.language || "en").split("-")[0];
  if (locale === "en" || draftHintText.value !== DRAFT_HINT_EN) return;
  try {
    const res = await fetch("/api/translation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ namespace: "mulmoterminal-ui", targetLanguage: locale, sentences: [DRAFT_HINT_EN] }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { translations?: string[] };
    if (typeof data.translations?.[0] === "string") draftHintText.value = data.translations[0];
  } catch {
    // leave the English fallback
  }
}
function showDraftHint() {
  draftHint.value = true;
  clearTimeout(draftHintTimer);
  draftHintTimer = setTimeout(() => (draftHint.value = false), 6000);
  localizeDraftHint();
}
function clearDraftHint() {
  clearTimeout(draftHintTimer);
  draftHint.value = false;
}
onUnmounted(() => clearTimeout(draftHintTimer));

// A collection action spawned a new chat and wants it shown: close the browse overlay
// (if open) and select the session so the terminal displays it. A draft also shows the
// preparing hint until claude is ready for the prefilled text.
registerChatOpener((id: string, opts?: { draft?: boolean }) => {
  browseClose();
  selectSession(id);
  if (opts?.draft) showDraftHint();
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
        <Transition name="draft-hint-fade">
          <div v-if="draftHint" class="draft-hint" role="status">
            <span class="material-symbols-outlined" aria-hidden="true">edit_note</span>
            <span>{{ draftHintText }}</span>
          </div>
        </Transition>
        <TerminalView
          ref="terminalRef"
          class="terminal-pane"
          :style="{ flex: `0 0 ${terminalWidth}px` }"
          :session-id="activeId"
          :connect-key="connectKey"
          :dir-theme="singleDirConfig.theme"
          :dir-colors="singleDirConfig.colors"
          :dir-name="singleDirConfig.name"
          :dir-badge-color="singleDirConfig.badgeColor"
          run-menu
          @session="onSession"
          @cwd="(c) => (activeCwd = c)"
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
  position: relative; /* anchor the draft hint overlay */
}

/* Transient "preparing your draft…" hint, overlaid at the top of the terminal area. */
.draft-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  max-width: min(90%, 640px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(30, 30, 30, 0.92);
  color: #eee;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-size: 13px;
  line-height: 1.4;
  pointer-events: none; /* never intercept clicks meant for the terminal */
}
.draft-hint .material-symbols-outlined {
  font-size: 18px;
  flex-shrink: 0;
}
.draft-hint-fade-enter-active,
.draft-hint-fade-leave-active {
  transition: opacity 0.25s ease;
}
.draft-hint-fade-enter-from,
.draft-hint-fade-leave-to {
  opacity: 0;
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
