<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import TerminalGrid from "./TerminalGrid.vue";
import SettingsModal from "./SettingsModal.vue";
import {
  initialState,
  addCell,
  setSession,
  setCwd,
  closeCell,
  toggleExpand,
  switchPage,
  runCommand,
  pageCount,
  zoomedUid,
  visibleCells,
  runningCount,
  STATE_KEY,
  LEGACY_KEY,
  type GridState,
} from "./gridTabs";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import type { CwdPreset } from "./presets";
import { useAppConfig } from "../composables/useAppConfig";

// The multi-terminal grid view. Toggled with the classic single view from App.vue.
const emit = defineEmits<{ (e: "exit"): void }>();

// Attention-sound toggle (shared singleton with the single view's toolbar).
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();

// One flat list of terminal cells; tabs are just pages (9 each) over it. Closing a
// cell reflows the list so terminals flow across page boundaries. Only the active
// page is mounted — other pages' terminals live on as background PTYs and
// reconnect when their page is shown again.
const init = initialState(localStorage.getItem(STATE_KEY), localStorage.getItem(LEGACY_KEY));
const state = ref<GridState>(init.state);
const persist = () => localStorage.setItem(STATE_KEY, JSON.stringify(state.value));
// Write the migrated state before dropping the legacy key, so a reload between
// migration and the first change can't lose the sessions.
if (init.migrated) {
  persist();
  localStorage.removeItem(LEGACY_KEY);
}
watch(state, persist, { deep: true });

const pages = computed(() => pageCount(state.value.cells.length));
// While a cell is zoomed, render EVERY cell so the filmstrip lines up all tabs'
// terminals (live); otherwise just the active page. The flat cells array makes
// this a single source swap (see visibleCells/zoomedUid).
const displayCells = computed(() => visibleCells(state.value));
const expandedUid = computed(() => zoomedUid(state.value));
// A launch cell is open beyond the sole entry cell (so "+ Terminal" cancels it). A
// trailing command cell is occupied, not an open launcher.
const launchOpen = computed(() => {
  const last = state.value.cells[state.value.cells.length - 1];
  return !!last && last.session === null && last.command == null && state.value.cells.length > 1;
});

function onAddTerminal() {
  if (runningCount(state.value.cells) >= 81 && !launchOpen.value) return; // surfaced by the disabled button
  state.value = addCell(state.value);
}
const onSession = (uid: number, id: string) => (state.value = setSession(state.value, uid, id));
const onCwd = (uid: number, cwd: string) => (state.value = setCwd(state.value, uid, cwd));
const onClose = (uid: number) => (state.value = closeCell(state.value, uid));
const onToggleExpand = (uid: number) => (state.value = toggleExpand(state.value, uid));
const onRun = (uid: number, command: { index: number; label: string; cwd: string | null }) => (state.value = runCommand(state.value, uid, command));
const switchTo = (page: number) => (state.value = switchPage(state.value, page));

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
      <button
        class="tb-btn tb-add"
        :class="{ active: launchOpen }"
        :title="launchOpen ? 'Cancel adding a terminal' : 'New terminal (overflows to a new tab when full)'"
        @click="onAddTerminal"
      >
        ＋ Terminal
      </button>
      <button
        class="tb-btn"
        :title="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
        :aria-label="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
        :aria-pressed="soundEnabled"
        @click="toggleSound"
      >
        {{ soundEnabled ? "🔔" : "🔕" }}
      </button>
      <button class="tb-btn" title="Single view" aria-label="Switch to single view" @click="emit('exit')">▢ Single</button>
      <button class="tb-btn" title="Settings" aria-label="Settings" @click="showSettings = true">⚙</button>
    </header>
    <nav v-if="pages > 1 && expandedUid === null" class="tabbar" aria-label="Grid tabs">
      <button v-for="p in pages" :key="p" :class="['tab', { active: p - 1 === state.page }]" :aria-pressed="p - 1 === state.page" @click="switchTo(p - 1)">
        {{ p }}
      </button>
    </nav>
    <TerminalGrid
      class="main"
      :cells="displayCells"
      :expanded-uid="expandedUid"
      :default-cwd="defaultCwd"
      :presets="presets"
      :home="home"
      @session="onSession"
      @cwd="onCwd"
      @close="onClose"
      @toggle-expand="onToggleExpand"
      @run="onRun"
    />
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

.tb-add {
  margin-left: auto;
}
.tb-add.active {
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

.tabbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 16px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.tab {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  min-width: 28px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.tab.active {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent);
}

.main {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
