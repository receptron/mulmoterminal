<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
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
  setSortMode,
  moveCell,
  visibleOrdered,
  activityStatus,
  cancelableLaunchUid,
  pageCount,
  zoomedUid,
  runningCount,
  STATE_KEY,
  LEGACY_KEY,
  type GridState,
  type CellStatus,
} from "./gridTabs";
import { useSessions } from "../composables/useSessions";
import { usePendingScript } from "../composables/usePendingScript";
import { reportActiveTerminals } from "../composables/useUnloadGuard";
import { useAppConfig } from "../composables/useAppConfig";

// The multi-terminal grid view, shown at /terminals. Leaving the grid is just a
// route push from the shared toolbar (Chat / Collections / a favorite), so there's
// no exit emit — App.vue renders this only while route.name === "terminals".

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

// Feed the tab-close guard: warn on close/reload while any cell runs a session or
// command (counts every page, not just the mounted one).
watch(
  () => runningCount(state.value.cells),
  (n) => reportActiveTerminals("grid", n),
  { immediate: true },
);

const pages = computed(() => pageCount(state.value.cells.length));

// The "auto" order needs every cell's status, including cells on pages that aren't
// mounted. The server's session list is the authority for that (it covers all
// sessions regardless of which page is on screen), so it drives the sort by session
// id. The per-cell `statusByUid` (reported up while a cell is mounted) is the
// fallback for cells the session list can't key: command cells (no session id) and a
// just-launched cell before its id arrives.
const { sessions } = useSessions();
const statusByUid = reactive<Record<number, CellStatus>>({});
const onStatus = (uid: number, s: CellStatus) => (statusByUid[uid] = s);
const sessionStatus = computed(() => {
  const m = new Map<string, CellStatus>();
  for (const s of sessions.value) m.set(s.id, activityStatus(s.working, s.waiting, s.event));
  return m;
});
const statusForSort = computed<Record<number, CellStatus>>(() => {
  const out: Record<number, CellStatus> = {};
  for (const c of state.value.cells) {
    const fromSession = c.session ? sessionStatus.value.get(c.session) : undefined;
    out[c.uid] = fromSession ?? statusByUid[c.uid] ?? "idle";
  }
  return out;
});
const reorderable = computed(() => state.value.sortMode === "manual");
// In "auto" mode the whole list is attention-sorted then paged (a waiting cell from
// any page floats to the front); "manual" keeps the hand-arranged order. While a cell
// is zoomed, render EVERY cell so the filmstrip lines up all tabs' terminals (live).
const displayCells = computed(() => visibleOrdered(state.value, statusForSort.value));
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
const onMove = (uid: number, dir: -1 | 1) => (state.value = moveCell(state.value, uid, dir));
const toggleSortMode = () => (state.value = setSortMode(state.value, state.value.sortMode === "auto" ? "manual" : "auto"));
const switchTo = (page: number) => (state.value = switchPage(state.value, page));

// A script the single view's terminal-header Run menu handed off: run it in a spare
// cell now that the grid (where command cells live) is mounted.
const { takePending } = usePendingScript();
onMounted(() => {
  const command = takePending();
  if (command) state.value = runScriptInNewCell(state.value, command);
});

// Server config: the default workspace dir + the auto-recorded dir presets + sound.
const { defaultCwd, home, presets, soundFile, loadConfig, recordPreset, removePreset, saveSound } = useAppConfig();
const showSettings = ref(false);
onMounted(loadConfig);

function closeSettings() {
  showSettings.value = false;
}
</script>

<template>
  <div class="shell">
    <AppToolbar
      :add-terminal-active="launchOpen"
      :auto-sort="state.sortMode === 'auto'"
      @add-terminal="onAddTerminal"
      @toggle-sort="toggleSortMode"
      @settings="showSettings = true"
    />
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
      :reorderable="reorderable"
      :open-session-ids="openSessionIds"
      @session="onSession"
      @cwd="onCwd"
      @record-cwd="recordPreset"
      @remove-preset="removePreset"
      @close="onClose"
      @toggle-expand="onToggleExpand"
      @run="onRun"
      @run-spare="onRunSpare"
      @move="onMove"
      @status="onStatus"
    />
    <SettingsModal v-if="showSettings" :sound-file="soundFile" @update-sound="saveSound" @close="closeSettings" />
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
