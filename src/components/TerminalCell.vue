<script setup lang="ts">
import { ref } from "vue";
import TerminalView from "./Terminal.vue";

// One grid cell. Empty until the user launches it (lazy launch — we don't spawn
// a claude process for an unused cell). Once launched it mounts a Terminal, which
// opens its own WebSocket / PTY; closing the cell unmounts it (the server reaps
// the idle session).
const launched = ref(false);
const sessionId = ref<string | null>(null);
const connectKey = ref(0);

function launch() {
  sessionId.value = null; // new session — the server generates the id
  connectKey.value++;
  launched.value = true;
}

function close() {
  launched.value = false;
  sessionId.value = null;
}

// Adopt the server-assigned id so the header can show which session this is.
function onSession(id: string) {
  sessionId.value = id;
}

const shortId = (id: string | null) => (id ? id.slice(0, 8) : "starting…");
</script>

<template>
  <div class="cell">
    <template v-if="launched">
      <div class="cell-header">
        <span class="cell-id" :title="sessionId ?? ''">{{ shortId(sessionId) }}</span>
        <button class="cell-close" title="Close terminal" @click="close">✕</button>
      </div>
      <TerminalView class="cell-term" :session-id="sessionId" :connect-key="connectKey" @session="onSession" />
    </template>
    <button v-else class="cell-empty" @click="launch">＋ New terminal</button>
  </div>
</template>

<style scoped>
.cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  overflow: hidden;
}

.cell-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  padding: 0 8px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}
.cell-id {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: #9aa3c0;
}
.cell-close {
  border: none;
  background: transparent;
  color: #9aa3c0;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
}
.cell-close:hover {
  color: #ff6b6b;
}

.cell-term {
  flex: 1;
  min-height: 0;
}

.cell-empty {
  flex: 1;
  border: none;
  background: transparent;
  color: #6b7394;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 13px;
}
.cell-empty:hover {
  background: #20203a;
  color: #c7cdf0;
}
</style>
