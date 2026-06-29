<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import TerminalGrid from "./TerminalGrid.vue";
import SettingsModal from "./SettingsModal.vue";
import AppToolbar from "./AppToolbar.vue";
import {
  initialState,
  addCell,
  setSession,
  setCwd,
  closeCell,
  toggleExpand,
  switchPage,
  runCommand,
  runScriptInNewCell,
  cancelableLaunchUid,
  pageCount,
  zoomedUid,
  visibleCells,
  runningCount,
  STATE_KEY,
  LEGACY_KEY,
  type GridState,
} from "./gridTabs";
import { usePendingScript } from "../composables/usePendingScript";
import type { CwdPreset } from "./presets";
import { useAppConfig } from "../composables/useAppConfig";

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
// While a cell is zoomed, render EVERY cell so the filmstrip lines up all tabs'
// terminals (live); otherwise just the active page. The flat cells array makes
// this a single source swap (see visibleCells/zoomedUid).
const displayCells = computed(() => visibleCells(state.value));
const expandedUid = computed(() => zoomedUid(state.value));
// The cancelable trailing launch cell's uid (null when there's nothing to cancel):
// drives both the toolbar's cancel state and the launcher's in-cell ✕.
const cancelUid = computed(() => cancelableLaunchUid(state.value));
const launchOpen = computed(() => cancelUid.value !== null);
// Session ids currently held by cells (across all pages — off-page cells stay
// live as background PTYs). A launcher uses this to warn before resuming a
// session that's already open, since attaching would detach the other cell.
const openSessionIds = computed(() => state.value.cells.map((c) => c.session).filter((s): s is string => s !== null));

function onAddTerminal() {
  if (runningCount(state.value.cells) >= 81 && !launchOpen.value) return; // surfaced by the disabled button
  state.value = addCell(state.value);
}
const onSession = (uid: number, id: string) => (state.value = setSession(state.value, uid, id));
const onCwd = (uid: number, cwd: string) => (state.value = setCwd(state.value, uid, cwd));
const onClose = (uid: number) => (state.value = closeCell(state.value, uid));
const onToggleExpand = (uid: number) => (state.value = toggleExpand(state.value, uid));
const onRun = (uid: number, command: { index: number; label: string; cwd: string | null }) => (state.value = runCommand(state.value, uid, command));
// A running cell's header Run menu: launch in a spare cell so the session survives.
const onRunSpare = (command: { index: number; label: string; cwd: string | null }) => (state.value = runScriptInNewCell(state.value, command));
const switchTo = (page: number) => (state.value = switchPage(state.value, page));

// A script the single view's terminal-header Run menu handed off: run it in a spare
// cell now that the grid (where command cells live) is mounted.
const { takePending } = usePendingScript();
onMounted(() => {
  const command = takePending();
  if (command) state.value = runScriptInNewCell(state.value, command);
});

// Server config: the default workspace dir + the user's directory presets + sound.
const {
  defaultCwd,
  home,
  presets,
  soundFile,
  saving: savingSettings,
  error: settingsError,
  loadConfig,
  savePresets: persistPresets,
  saveSound,
} = useAppConfig();
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
    <AppToolbar view-mode="grid" :add-terminal-active="launchOpen" @go-single="emit('exit')" @add-terminal="onAddTerminal" @settings="showSettings = true" />
    <nav v-if="pages > 1 && expandedUid === null" class="tabbar" aria-label="Grid tabs">
      <button v-for="p in pages" :key="p" :class="['tab', { active: p - 1 === state.page }]" :aria-pressed="p - 1 === state.page" @click="switchTo(p - 1)">
        {{ p }}
      </button>
    </nav>
    <TerminalGrid
      class="main"
      :cells="displayCells"
      :expanded-uid="expandedUid"
      :cancel-uid="cancelUid"
      :default-cwd="defaultCwd"
      :presets="presets"
      :home="home"
      :open-session-ids="openSessionIds"
      @session="onSession"
      @cwd="onCwd"
      @close="onClose"
      @toggle-expand="onToggleExpand"
      @run="onRun"
      @run-spare="onRunSpare"
    />
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
