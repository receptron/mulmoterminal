<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import Sidebar from "./components/Sidebar.vue";
import SessionTabBar from "./components/SessionTabBar.vue";
import TerminalView from "./components/Terminal.vue";
import GuiPanel from "./components/GuiPanel.vue";
import ToolsPane from "./components/ToolsPane.vue";

const activeId = ref<string | null>(null);
const connectKey = ref(0);
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);

// Terminal column width (px), set by dragging the splitter between the terminal
// and the GUI panel; the GUI panel absorbs whatever is left. Persisted across
// reloads. The terminal's own ResizeObserver refits xterm's cols/rows as this
// changes, so a drag live-resizes the PTY.
const MIN_TERMINAL = 320;
const MIN_GUI = 360;
const terminalWidth = ref<number>(Number(localStorage.getItem("terminal_width")) || 560);

function clampWidth(w: number): number {
  return Math.max(MIN_TERMINAL, Math.min(w, window.innerWidth - MIN_GUI));
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
    localStorage.setItem("terminal_width", String(terminalWidth.value));
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
onUnmounted(() => stopDrag?.());

// Session-history layout: "vertical" (left Sidebar) or "horizontal" (top
// SessionTabBar), mirroring mulmoclaude's two history layouts. Persisted across
// reloads like the tools pane.
type Layout = "vertical" | "horizontal";
const layout = ref<Layout>(
  localStorage.getItem("session_layout") === "horizontal" ? "horizontal" : "vertical"
);
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
  <div :class="['app', layout === 'horizontal' ? 'app-horizontal' : 'app-vertical']">
    <Sidebar
      v-if="layout === 'vertical'"
      :active-id="activeId"
      @select="selectSession"
      @new="newSession"
      @toggle-layout="toggleLayout"
    />
    <SessionTabBar
      v-else
      :active-id="activeId"
      @select="selectSession"
      @new="newSession"
      @toggle-layout="toggleLayout"
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
        title="Drag to resize the terminal"
        @mousedown="startDrag"
      />
      <GuiPanel
        :session-id="activeId"
        :send-text-message="sendTextMessage"
        :tools-open="showTools"
        @toggle-tools="toggleTools"
      />
      <ToolsPane v-if="showTools" :session-id="activeId" />
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  width: 100vw;
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

/* [ Terminal | GuiPanel ] — the unified two-panel view in miniature. */
.main {
  display: flex;
  flex: 1;
  min-width: 0;
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
  background: #16213e;
  border-left: 1px solid #2a2a4e;
  border-right: 1px solid #2a2a4e;
}
.splitter:hover {
  background: #2a3b66;
}
</style>
