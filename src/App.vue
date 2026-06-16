<script setup lang="ts">
import { ref, watch } from "vue";
import Sidebar from "./components/Sidebar.vue";
import TerminalView from "./components/Terminal.vue";
import GuiPanel from "./components/GuiPanel.vue";
import ToolsPane from "./components/ToolsPane.vue";

const activeId = ref<string | null>(null);
const connectKey = ref(0);
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);

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
  <div class="app">
    <Sidebar
      :active-id="activeId"
      @select="selectSession"
      @new="newSession"
    />
    <div class="main">
      <TerminalView
        ref="terminalRef"
        :session-id="activeId"
        :connect-key="connectKey"
        @session="onSession"
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

/* Sidebar | [ Terminal | GuiPanel ] — the unified two-panel view in miniature. */
.main {
  display: flex;
  flex: 1;
  min-width: 0;
}
</style>
