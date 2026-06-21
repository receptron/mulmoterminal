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
  pageCount,
  pageSlice,
  runningCount,
  STATE_KEY,
  LEGACY_KEY,
  type GridState,
} from "./gridTabs";
import type { CwdPreset } from "./presets";

// The multi-terminal grid view. Toggled with the classic single view from App.vue.
const emit = defineEmits<{ (e: "exit"): void }>();

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
const pageCells = computed(() => pageSlice(state.value.cells, state.value.page));
const pageExpanded = computed(() =>
  state.value.expanded !== null && pageCells.value.some((c) => c.uid === state.value.expanded) ? state.value.expanded : null,
);
// A launch cell is open beyond the sole entry cell (so "+ Terminal" cancels it).
const launchOpen = computed(() => {
  const last = state.value.cells[state.value.cells.length - 1];
  return !!last && last.session === null && state.value.cells.length > 1;
});

function onAddTerminal() {
  if (runningCount(state.value.cells) >= 81 && !launchOpen.value) return; // surfaced by the disabled button
  state.value = addCell(state.value);
}
const onSession = (uid: number, id: string) => (state.value = setSession(state.value, uid, id));
const onCwd = (uid: number, cwd: string) => (state.value = setCwd(state.value, uid, cwd));
const onClose = (uid: number) => (state.value = closeCell(state.value, uid));
const onToggleExpand = (uid: number) => (state.value = toggleExpand(state.value, uid));
const switchTo = (page: number) => (state.value = switchPage(state.value, page));

// Server config: the default workspace dir + the user's directory presets.
const defaultCwd = ref<string | null>(null);
const home = ref<string | null>(null);
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
    home.value = c.home ?? null;
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
      <button
        class="tb-btn tb-add"
        :class="{ active: launchOpen }"
        :title="launchOpen ? 'Cancel adding a terminal' : 'New terminal (overflows to a new tab when full)'"
        @click="onAddTerminal"
      >
        ＋ Terminal
      </button>
      <button class="tb-btn" title="Single view" aria-label="Switch to single view" @click="emit('exit')">▢ Single</button>
      <button class="tb-btn" title="Settings" aria-label="Settings" @click="showSettings = true">⚙</button>
    </header>
    <nav v-if="pages > 1" class="tabbar" aria-label="Grid tabs">
      <button v-for="p in pages" :key="p" :class="['tab', { active: p - 1 === state.page }]" :aria-pressed="p - 1 === state.page" @click="switchTo(p - 1)">
        {{ p }}
      </button>
    </nav>
    <TerminalGrid
      class="main"
      :cells="pageCells"
      :expanded-uid="pageExpanded"
      :default-cwd="defaultCwd"
      :presets="presets"
      :home="home"
      @session="onSession"
      @cwd="onCwd"
      @close="onClose"
      @toggle-expand="onToggleExpand"
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

.tb-add {
  margin-left: auto;
}
.tb-add.active {
  background: #2a3b66;
  color: #fff;
  border-color: #4a8cff;
}

.tb-btn {
  border: 1px solid #2a2a4e;
  background: #1a1a2e;
  color: #c7cdf0;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.tb-btn:hover {
  background: #2a3b66;
  color: #fff;
}

.tabbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 16px;
  background: #14203a;
  border-bottom: 1px solid #2a2a4e;
}
.tab {
  border: 1px solid #2a2a4e;
  background: #1a1a2e;
  color: #9aa3c0;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  min-width: 28px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.tab:hover {
  background: #2a3b66;
  color: #e6e6f0;
}
.tab.active {
  background: #2a3b66;
  color: #fff;
  border-color: #4a8cff;
}

.main {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
