<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import TerminalGrid from "./TerminalGrid.vue";
import SettingsModal from "./SettingsModal.vue";
import { LAYOUTS, isLayout, type Layout } from "./gridLayout";
import type { CwdPreset } from "./presets";
import { useAppConfig } from "../composables/useAppConfig";

// The multi-terminal grid view. Toggled with the classic single view from App.vue.
const emit = defineEmits<{ (e: "exit"): void }>();

// Grid layout (cell arrangement), chosen in the toolbar and persisted.
const stored = localStorage.getItem("grid_layout");
const layout = ref<Layout>(isLayout(stored) ? stored : "2x2");
watch(layout, (v) => localStorage.setItem("grid_layout", v));

// Server config: the default workspace dir + the user's directory presets.
const { defaultCwd, home, presets, saving: savingSettings, error: settingsError, loadConfig, savePresets: persistPresets } = useAppConfig();
const showSettings = ref(false);
onMounted(loadConfig);

async function savePresets(next: CwdPreset[]) {
  if (await persistPresets(next)) showSettings.value = false; // close only on success — keep edits otherwise
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
      <button class="tb-btn" title="Single view" aria-label="Switch to single view" @click="emit('exit')">▢ Single</button>
      <button class="tb-btn" title="Settings" aria-label="Settings" @click="showSettings = true">⚙</button>
    </header>
    <TerminalGrid class="main" :layout="layout" :default-cwd="defaultCwd" :presets="presets" :home="home" />
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

.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
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

.layout-picker {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.layout-btn {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.layout-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.layout-btn.active {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent);
}

.tb-btn {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-family: system-ui, sans-serif;
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.tb-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.main {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
