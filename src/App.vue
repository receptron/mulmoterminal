<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import TerminalGrid from "./components/TerminalGrid.vue";
import SettingsModal from "./components/SettingsModal.vue";
import { LAYOUTS, isLayout, type Layout } from "./components/gridLayout";
import type { CwdPreset } from "./components/presets";

// Grid layout (cell arrangement), chosen in the toolbar and persisted.
const stored = localStorage.getItem("grid_layout");
const layout = ref<Layout>(isLayout(stored) ? stored : "2x2");
watch(layout, (v) => localStorage.setItem("grid_layout", v));

// Server config: the default workspace dir + the user's directory presets.
const defaultCwd = ref<string | null>(null);
const presets = ref<CwdPreset[]>([]);
const showSettings = ref(false);
const savingSettings = ref(false);
const settingsError = ref<string | null>(null);

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const c = await res.json();
    defaultCwd.value = c.cwd ?? null;
    presets.value = Array.isArray(c.cwdPresets) ? c.cwdPresets : [];
  } catch {
    // grid still works; presets just unavailable
  }
}
onMounted(loadConfig);

async function savePresets(next: CwdPreset[]) {
  savingSettings.value = true;
  settingsError.value = null;
  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwdPresets: next }),
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    presets.value = (await res.json()).cwdPresets ?? [];
    showSettings.value = false; // close only on success — keep edits otherwise
  } catch {
    settingsError.value = "Couldn't save presets. Check the server and try again.";
  } finally {
    savingSettings.value = false;
  }
}

function closeSettings() {
  showSettings.value = false;
  settingsError.value = null;
}
</script>

<template>
  <div class="shell">
    <header class="toolbar">
      <span class="toolbar-title">MulmoTerminal</span>
      <span class="layout-picker" role="group" aria-label="Grid layout">
        <button v-for="l in LAYOUTS" :key="l" :class="['layout-btn', { active: layout === l }]" :aria-pressed="layout === l" @click="layout = l">
          {{ l }}
        </button>
      </span>
      <button class="settings-btn" title="Settings" aria-label="Settings" @click="showSettings = true">⚙</button>
    </header>
    <TerminalGrid class="main" :layout="layout" :default-cwd="defaultCwd" :presets="presets" />
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

/* Top toolbar with the app title + layout picker + settings. */
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 40px;
  padding: 0 16px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}
.toolbar-title {
  font-family: system-ui, sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: #e6e6f0;
  letter-spacing: 0.02em;
}

.layout-picker {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.layout-btn {
  border: 1px solid #2a2a4e;
  background: #1a1a2e;
  color: #9aa3c0;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.layout-btn:hover {
  background: #2a3b66;
  color: #e6e6f0;
}
.layout-btn.active {
  background: #2a3b66;
  color: #fff;
  border-color: #4a8cff;
}

.settings-btn {
  border: 1px solid #2a2a4e;
  background: #1a1a2e;
  color: #c7cdf0;
  font-size: 15px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.settings-btn:hover {
  background: #2a3b66;
  color: #fff;
}

/* The grid fills everything under the toolbar. */
.main {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
