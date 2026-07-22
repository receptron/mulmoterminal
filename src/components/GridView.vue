<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated } from "vue";
import TerminalGrid from "./TerminalGrid.vue";
import SettingsModal from "./SettingsModal.vue";
import AppToolbar from "./AppToolbar.vue";
import { startCollectionChat } from "../composables/useChatLauncher";
import { router } from "../router";
import {
  initialState,
  addCell,
  setSession,
  setCwd,
  setCellAgent,
  closeCell,
  toggleExpand,
  switchPage,
  runCommand,
  runScriptInNewCell,
  insertCellAfter,
  shellCell,
  launchInCell,
  setSortMode,
  moveCell,
  visibleOrdered,
  activityStatus,
  countByStatus,
  cancelableLaunchUid,
  pageCount,
  zoomedUid,
  runningCount,
  STATE_KEY,
  LEGACY_KEY,
  type GridState,
  type CellStatus,
  type Cell,
  resolveCellStatus,
  MAX_TERMINALS,
} from "./gridTabs";
import type { RunCommand } from "./runCommand";
import { isPrPhase, isWorkPhase, type PrPhase, type WorkPhase } from "./rosterPhase";
import { useGridActivity } from "../composables/useGridActivity";
import { registerNewTerminalHandler, type NewTerminalRequest } from "../composables/useNewTerminal";
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
// mounted. useGridActivity tracks each cell session's live attention state by id —
// including OFF-PAGE, dev-terminal cells that the /api/sessions list drops and its
// limit would cap — so a waiting cell on any page floats forward. The per-cell
// `statusByUid` (reported up while a cell is mounted) is the fallback for cells with
// no session id (command cells) and a just-launched cell before its id arrives.
const cellSessionIds = computed(() => state.value.cells.map((c) => c.session).filter((s): s is string => !!s));
const { activity: gridActivity } = useGridActivity(cellSessionIds);
const statusByUid = reactive<Record<number, CellStatus>>({});
const onStatus = (uid: number, s: CellStatus) => (statusByUid[uid] = s);
const sessionStatus = computed(() => {
  const m = new Map<string, CellStatus>();
  for (const [id, a] of gridActivity) m.set(id, activityStatus(a.working, a.waiting, a.event));
  return m;
});
const statusForSort = computed<Record<number, CellStatus>>(() => resolveCellStatus(state.value.cells, sessionStatus.value, statusByUid));
// At-a-glance tally across ALL pages, for the toolbar summary.
const statusCounts = computed(() => countByStatus(state.value.cells, statusForSort.value));
const reorderable = computed(() => state.value.sortMode === "manual");
// In "auto" mode the whole list is attention-sorted then paged (a waiting cell from
// any page floats to the front); "manual" keeps the hand-arranged order. While a cell
// is zoomed, render EVERY cell so the filmstrip lines up all tabs' terminals (live).
const displayCells = computed(() => visibleOrdered(state.value, statusForSort.value));
const expandedUid = computed(() => zoomedUid(state.value));

// The zoomed grid's cockpit roster: a text row per cell — status + dir + AI summary +
// current prompt + the agent's latest reply — so many parallel agents can be supervised
// past the 9-thumbnail grid, and the enlarged terminal is switched by picking a row.
type SessionMeta = { lastPrompt: string | null; aiTitle: string | null; lastResponse: string | null; workPhase: WorkPhase | null };
const sessionMeta = reactive(new Map<string, SessionMeta>());
// Single source of truth for the roster's prompt / summary / reply: each cell's on-disk
// transcript, read via GET /api/session/:id (always current, and works for sessions this
// MulmoTerminal doesn't manage — a plain `claude` you resumed emits nothing over pub/sub).
// Seed on appearance, then poll while the roster is on screen. Merge, never overwrite: a
// fetch that can't find the transcript (absent/mismatched cwd) returns nulls that must not
// wipe a value already shown. (The status badge is separate — it rides `statusForSort`.)
async function seedMeta(id: string, cwd: string | null) {
  try {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const res = await fetch(`/api/session/${id}${query}`);
    if (!res.ok) return;
    const d = (await res.json()) as Partial<SessionMeta>;
    const prev = sessionMeta.get(id) ?? { lastPrompt: null, aiTitle: null, lastResponse: null, workPhase: null };
    sessionMeta.set(id, {
      lastPrompt: d.lastPrompt ?? prev.lastPrompt,
      aiTitle: d.aiTitle ?? prev.aiTitle,
      lastResponse: d.lastResponse ?? prev.lastResponse,
      // A successful fetch is authoritative for workPhase (unlike the text fields, which the
      // summary can transiently miss), so take it as-is — including null (no tools / not working).
      workPhase: isWorkPhase(d.workPhase) ? d.workPhase : null,
    });
  } catch {
    // best-effort — the next poll retries
  }
}
const refreshAllMeta = () => state.value.cells.forEach((c) => c.session && void seedMeta(c.session, c.cwd));
watch(() => state.value.cells.map((c) => c.session ?? "").join(","), refreshAllMeta, { immediate: true });

// The PR workflow phase per directory (GET /api/pr-phase), shown in the roster beside the
// agent status. Keyed by cwd, not session — the phase is the branch's, so cells sharing a dir
// share one fetch. Best-effort and cached server-side, so the roster poll can re-fetch cheaply.
const phaseByCwd = reactive(new Map<string, PrPhase>());
async function seedPhase(cwd: string) {
  try {
    const res = await fetch(`/api/pr-phase?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok) return;
    const d = (await res.json()) as { phase?: unknown };
    if (isPrPhase(d.phase)) phaseByCwd.set(cwd, d.phase);
  } catch {
    // best-effort — the next poll retries
  }
}
const refreshAllPhases = () => {
  const cwds = new Set(state.value.cells.map((c) => c.cwd).filter((c): c is string => c !== null));
  cwds.forEach((cwd) => void seedPhase(cwd));
};
const refreshRoster = () => {
  refreshAllMeta();
  refreshAllPhases();
};
const ROSTER_POLL_MS = 4000;
let rosterTimer: ReturnType<typeof setInterval> | null = null;
// The roster is the sole consumer of this poll, and it's shown only while zoomed AND in list
// mode (the grid can be zoomed into the thumbnail strip instead). Poll exactly when it's visible.
const listModeOn = ref(true);
const rosterVisible = () => expandedUid.value !== null && listModeOn.value;
const startPoll = () => {
  if (!rosterVisible() || rosterTimer !== null) return;
  refreshRoster();
  rosterTimer = setInterval(refreshRoster, ROSTER_POLL_MS);
};
const stopPoll = () => {
  if (rosterTimer !== null) clearInterval(rosterTimer);
  rosterTimer = null;
};
const syncPoll = () => (rosterVisible() ? startPoll() : stopPoll());
// immediate: a reload that restores a zoomed grid sets expandedUid up front (no "change"
// to react to), so start here too, or the roster would freeze at its first snapshot.
watch(expandedUid, syncPoll, { immediate: true });
const onListMode = (on: boolean) => {
  listModeOn.value = on;
  syncPoll();
};
// Under <KeepAlive>, leaving /terminals deactivates (doesn't unmount) this view — pause the
// poll so it doesn't keep fetching in the background, and resume it on return.
onActivated(startPoll);
onDeactivated(stopPoll);
onBeforeUnmount(stopPoll);

// A cell with no session/prompt yet still gets a human label from what it IS running.
const fallbackLabel = (c: Cell): string | null => c.command?.label ?? c.launcher?.label ?? (c.session ? "starting…" : "empty");
const listRows = computed(() =>
  state.value.cells.map((c) => {
    const meta = c.session ? sessionMeta.get(c.session) : undefined;
    return {
      uid: c.uid,
      cwd: c.cwd,
      agent: c.agent ?? "claude",
      status: statusForSort.value[c.uid] ?? ("idle" as CellStatus),
      summary: meta?.aiTitle ?? null,
      prompt: meta?.lastPrompt ?? null,
      response: meta?.lastResponse ?? null,
      fallback: fallbackLabel(c),
      phase: (c.cwd ? phaseByCwd.get(c.cwd) : undefined) ?? ("none" as PrPhase),
      workPhase: meta?.workPhase ?? null,
    };
  }),
);
// The cancelable trailing launch cell's uid (null when there's nothing to cancel):
// drives both the toolbar's cancel state and the launcher's in-cell ✕.
const cancelUid = computed(() => cancelableLaunchUid(state.value));
const launchOpen = computed(() => cancelUid.value !== null);
// Session ids currently held by cells (across all pages — off-page cells stay
// live as background PTYs). A launcher uses this to warn before resuming a
// session that's already open, since attaching would detach the other cell.
const openSessionIds = computed(() => state.value.cells.map((c) => c.session).filter((s): s is string => s !== null));
// Directories that already have a running session (a launched cell), so the launcher
// can flag preset chips whose dir is in use elsewhere.
const openCwds = computed(() =>
  state.value.cells
    .filter((c) => c.session)
    .map((c) => c.cwd)
    .filter((c): c is string => c !== null),
);

function onAddTerminal() {
  if (runningCount(state.value.cells) >= MAX_TERMINALS && !launchOpen.value) return; // surfaced by the disabled button
  state.value = addCell(state.value);
}
const onSession = (uid: number, id: string) => (state.value = setSession(state.value, uid, id));
const onCwd = (uid: number, cwd: string) => (state.value = setCwd(state.value, uid, cwd));
const onAgent = (uid: number, agent: "claude" | "codex") => (state.value = setCellAgent(state.value, uid, agent));
// Pass the on-screen order so closing the zoomed cell stays zoomed on its filmstrip
// neighbour (previous, or next when it was the first) instead of collapsing the grid.
const onClose = (uid: number) =>
  (state.value = closeCell(
    state.value,
    uid,
    displayCells.value.map((c) => c.uid),
  ));
const onToggleExpand = (uid: number) => (state.value = toggleExpand(state.value, uid));
const onRun = (uid: number, command: RunCommand) => (state.value = runCommand(state.value, uid, command));
// A running cell's header Run menu: launch in a spare cell (next to it) so the session survives.
const onRunSpare = (uid: number, command: RunCommand) => (state.value = runScriptInNewCell(state.value, uid, command));
// The empty cell launcher picked a configured program (shell/codex/…): turn it into a
// persistent launcher cell. Its session id arrives later via onSession.
const onLaunch = (uid: number, pick: { index: number; label: string; cwd: string | null }) =>
  (state.value = launchInCell(state.value, uid, { index: pick.index, label: pick.label }, pick.cwd));
const onMove = (uid: number, dir: -1 | 1) => (state.value = moveCell(state.value, uid, dir));
const toggleSortMode = () => (state.value = setSortMode(state.value, state.value.sortMode === "auto" ? "manual" : "auto"));
const switchTo = (page: number) => (state.value = switchPage(state.value, page));

// A script the single view's terminal-header Run menu handed off: run it in a spare
// cell now that the grid (where command cells live) is mounted.
const { takePending } = usePendingScript();
const NO_ORIGIN_UID = -1; // no triggering cell (uids are >= 0) → insertCellAfter appends at the end
onMounted(() => {
  const command = takePending();
  if (command) state.value = runScriptInNewCell(state.value, NO_ORIGIN_UID, command);
});

// The header "new terminal" button ($SHELL) opens a cell next to the one that triggered it.
// GridView is cached by <KeepAlive>, so register the opener only while ACTIVE and drop it on
// deactivate — otherwise a button press from the single view would silently mutate this hidden
// grid instead of routing here. openTerminalAt then queues + navigates while we're deactivated.
const SLOT_UID_RE = /^cell-(\d+)$/;
let offNewTerminal: (() => void) | null = null;
const openNewTerminal = ({ cwd, afterSlotKey }: NewTerminalRequest) => {
  const match = afterSlotKey?.match(SLOT_UID_RE);
  const afterUid = match ? Number(match[1]) : NO_ORIGIN_UID;
  state.value = insertCellAfter(state.value, afterUid, shellCell(cwd));
};
const detachNewTerminal = () => {
  offNewTerminal?.();
  offNewTerminal = null;
};
onActivated(() => (offNewTerminal = registerNewTerminalHandler(openNewTerminal)));
onDeactivated(detachNewTerminal);
onBeforeUnmount(detachNewTerminal);

// Server config: the default workspace dir + the auto-recorded dir presets + sound.
const {
  defaultCwd,
  home,
  presets,
  soundFile,
  pushEnabled,
  prRepos,
  launchers,
  userMcpServers,
  loadConfig,
  recordPreset,
  removePreset,
  saveSound,
  savePushEnabled,
  savePrRepos,
  saveLaunchers,
  saveUserMcpServers,
} = useAppConfig();
const showSettings = ref(false);
onMounted(loadConfig);

function closeSettings() {
  showSettings.value = false;
}

// Launch the config skill in a new auto-running session and switch to the single view so it shows
// (the grid has no single active session). The skill then asks which directory / batch.
function configureAppearance() {
  closeSettings();
  router.push("/");
  void startCollectionChat("/mulmoterminal-config");
}
</script>

<template>
  <div class="flex flex-col h-screen w-screen overflow-hidden">
    <AppToolbar
      :add-terminal-active="launchOpen"
      :auto-sort="state.sortMode === 'auto'"
      :status-counts="statusCounts"
      @add-terminal="onAddTerminal"
      @toggle-sort="toggleSortMode"
      @settings="showSettings = true"
    />
    <nav
      v-if="pages > 1 && expandedUid === null"
      class="flex-none flex items-center gap-1 h-[30px] px-4 bg-panel border-b border-border"
      aria-label="Grid tabs"
    >
      <button
        v-for="p in pages"
        :key="p"
        class="border border-border bg-base text-muted font-mono text-xs min-w-[28px] py-[3px] px-2 rounded-md cursor-pointer hover:bg-hover hover:text-fg aria-pressed:bg-hover aria-pressed:text-fg aria-pressed:border-accent"
        :aria-pressed="p - 1 === state.page"
        @click="switchTo(p - 1)"
      >
        {{ p }}
      </button>
    </nav>
    <TerminalGrid
      class="flex-1 min-h-0 min-w-0"
      :cells="displayCells"
      :expanded-uid="expandedUid"
      :list-rows="listRows"
      :cancel-uid="cancelUid"
      :default-cwd="defaultCwd"
      :presets="presets"
      :launchers="launchers"
      :home="home"
      :reorderable="reorderable"
      :open-session-ids="openSessionIds"
      :open-cwds="openCwds"
      @session="onSession"
      @agent="onAgent"
      @cwd="onCwd"
      @record-cwd="recordPreset"
      @remove-preset="removePreset"
      @close="onClose"
      @toggle-expand="onToggleExpand"
      @run="onRun"
      @run-spare="onRunSpare"
      @launch="onLaunch"
      @move="onMove"
      @status="onStatus"
      @list-mode="onListMode"
    />
    <SettingsModal
      v-if="showSettings"
      :sound-file="soundFile"
      :push-enabled="pushEnabled"
      :pr-repos="prRepos"
      :launchers="launchers"
      :user-mcp-servers="userMcpServers"
      @update-sound="saveSound"
      @update-push-enabled="savePushEnabled"
      @update-repos="savePrRepos"
      @update-launchers="saveLaunchers"
      @update-user-mcp="saveUserMcpServers"
      @configure-appearance="configureAppearance"
      @close="closeSettings"
    />
  </div>
</template>
