<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import TerminalGrid, { type CockpitRow } from "./TerminalGrid.vue";
import AppSettingsModal from "./AppSettingsModal.vue";
import AppToolbar from "./AppToolbar.vue";
import GuideLinks from "./GuideLinks.vue";
import { startCollectionChat } from "../composables/useChatLauncher";
import { skillSeed } from "./skillSeed";
import type { BundledSkillName } from "../../common/bundledSkills";
import {
  initialState,
  addCell,
  setSession,
  setCwd,
  setCellAgent,
  setCellParked,
  closeCell,
  toggleExpand,
  switchPage,
  runCommand,
  runScriptInNewCell,
  insertCellAfter,
  shellCell,
  sessionCell,
  launchInCell,
  setSortMode,
  moveCell,
  moveZoom,
  toggleZoom,
  nextAttention,
  nextAttentionUid,
  orderCells,
  pageSlice,
  countByStatus,
  cancelableLaunchUid,
  pageCount,
  zoomedUid,
  runningCount,
  STATE_KEY,
  LEGACY_KEY,
  type GridState,
  type Cell,
  resolveCellStatus,
  MAX_TERMINALS,
} from "./gridTabs";
import { activityStatus, type AttentionStatus } from "./attentionStatus";
import { gridShortcutFor, isEditableTarget, type GridShortcut } from "../composables/gridShortcut";
import { useCaptureKeydown } from "../composables/useCaptureKeydown";
import { getActiveKeymap } from "../composables/activeKeymap";
import { preferredLaunchDir } from "./launchDir";
import * as conn from "../composables/useTerminalConnections";
import { rosterCellsKey, staleCacheKeys } from "./rosterCache";
import type { RunCommand } from "./runCommand";
import { becameCiFailing, EMPTY_SESSION_META, isPrPhase, mergeSessionMeta, type PrPhase, type SessionMetaView } from "./rosterPhase";
import { notifySound } from "../composables/notifySound";
import { useGridActivity } from "../composables/useGridActivity";
import { registerNewTerminalHandler, type NewTerminalRequest } from "../composables/useNewTerminal";
import { registerSpawnedChatHandler, type SpawnedChatRequest } from "../composables/useSpawnedChat";
import { usePendingScript } from "../composables/usePendingScript";
import { reportActiveTerminals } from "../composables/useUnloadGuard";
import { useAppConfig } from "../composables/useAppConfig";
import { fetchDirConfig, invalidateDirConfig, useDirPriorities } from "../composables/useDirConfig";
import { nextSortMode } from "./sortModeButton";
import { asTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { router } from "../router";
import { usePubSub } from "../composables/usePubSub";
import type { LaunchAgent } from "../../common/launchAgent";
import type { LaunchPick } from "./launchers";

// The multi-terminal grid view, shown at /terminals. Leaving the grid is just a
// route push from the shared toolbar (Chat / Collections / a favorite), so there's
// no exit emit — App.vue renders this only while route.name === "terminals".

// One flat list of terminal cells; tabs are just pages (9 each) over it. Closing a
// cell reflows the list so terminals flow across page boundaries. Only the active
// page is mounted — other pages' terminals live on as background PTYs and
// reconnect when their page is shown again.
// The ACTUAL route. The grid now stays mounted under a full-screen overlay, so "is the grid
// mounted" and "is the grid what the user is looking at" have come apart — several things below
// need the second question (Codex, PR #1193).
//
// The router singleton rather than useRoute(): this component is mounted without the plugin in its
// own specs, and overlayOrigin reads the same singleton for the same reason.
const onTerminalsRoute = () => router.currentRoute.value.name === "terminals";

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

// Nothing has been launched yet (only the entry launch cell) — show the newcomer a
// pointer to the guide, cleared the moment any terminal starts.
const noRunningTerminals = computed(() => runningCount(state.value.cells) === 0);

// The "auto" order needs every cell's status, including cells on pages that aren't
// mounted. useGridActivity tracks each cell session's live attention state by id —
// including OFF-PAGE, dev-terminal cells that the /api/sessions list drops and its
// limit would cap — so a waiting cell on any page floats forward. The per-cell
// `statusByUid` (reported up while a cell is mounted) is the fallback for cells with
// no session id (command cells) and a just-launched cell before its id arrives.
const cellSessionIds = computed(() => state.value.cells.map((c) => c.session).filter((s): s is string => !!s));
const { activity: gridActivity } = useGridActivity(cellSessionIds);
const statusByUid = reactive<Record<number, AttentionStatus>>({});
const onStatus = (uid: number, s: AttentionStatus) => (statusByUid[uid] = s);
// Which cell the cursor is in, reported up from the grid. Un-zoomed this is the only notion of
// "the terminal I am on", so the keyboard shortcuts rotate from it.
const focusedCellUid = ref<number | null>(null);
const sessionStatus = computed(() => {
  const m = new Map<string, AttentionStatus>();
  for (const [id, a] of gridActivity) m.set(id, activityStatus(a.working, a.waiting, a.event));
  return m;
});
const statusForSort = computed<Record<number, AttentionStatus>>(() => resolveCellStatus(state.value.cells, sessionStatus.value, statusByUid));
// At-a-glance tally across ALL pages, for the toolbar summary.
const statusCounts = computed(() => countByStatus(state.value.cells, statusForSort.value));
const reorderable = computed(() => state.value.sortMode === "manual");
// "priority" ranks cells by their directory's orderPriority, so like the status above it needs
// a value for cells on pages that aren't mounted — hence the whole cwd set, not per-cell.
const cellCwds = computed(() => [...new Set(state.value.cells.map((c) => c.cwd).filter((c): c is string => !!c))]);
const { priorities: priorityByCwd } = useDirPriorities(cellCwds);
// In "auto" mode the whole list is attention-sorted; "priority" orders by each directory's
// declared rank; "manual" keeps the hand-arranged order.
// The ONE ordering both the grid and the cockpit roster read, so the two can't drift (#720).
const orderedCells = computed(() => orderCells(state.value.cells, statusForSort.value, state.value.sortMode, priorityByCwd.value));
// The grid: while a cell is zoomed, render EVERY cell (the filmstrip lines up all tabs' terminals,
// live); otherwise just the active page's slice. A waiting cell from any page floats to the front.
const displayCells = computed(() => (zoomedUid(state.value) !== null ? orderedCells.value : pageSlice(orderedCells.value, state.value.page)));
const expandedUid = computed(() => zoomedUid(state.value));

// The zoomed grid's cockpit roster: a text row per cell — status + dir + the user's memo +
// AI summary + current prompt + the agent's latest reply — so many parallel agents can be
// supervised past the 9-thumbnail grid, and the enlarged terminal is switched by picking a row.
const sessionMeta = reactive(new Map<string, SessionMetaView>());
// Single source of truth for the roster's prompt / summary / reply: each cell's on-disk
// transcript, read via GET /api/session/:id (always current, and works for sessions this
// MulmoTerminal doesn't manage — a plain `claude` you resumed emits nothing over pub/sub).
// Seed on appearance, then poll while the roster is on screen. Merge, never overwrite: a
// fetch that can't find the transcript (absent/mismatched cwd) returns nulls that must not
// wipe a value already shown. (The status badge is separate — it rides `statusForSort`.)
// The roster polls every few seconds, so a slow answer can still be in flight when the next
// one goes out. Only the newest may be applied: an older one describes a moment already
// overtaken, and its fields would put back what the newer answer replaced (#620).
const latestMetaSeed = new Map<string, number>();
async function seedMeta(id: string, cwd: string | null) {
  const seed = (latestMetaSeed.get(id) ?? 0) + 1;
  latestMetaSeed.set(id, seed);
  try {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const res = await fetch(`/api/session/${id}${query}`);
    if (!res.ok || latestMetaSeed.get(id) !== seed) return;
    const d = (await res.json()) as Partial<SessionMetaView>;
    if (latestMetaSeed.get(id) !== seed) return;
    sessionMeta.set(id, mergeSessionMeta(sessionMeta.get(id) ?? EMPTY_SESSION_META, d));
  } catch {
    // best-effort — the next poll retries
  }
}
const refreshAllMeta = () => state.value.cells.forEach((c) => c.session && void seedMeta(c.session, c.cwd));
// The PR workflow phase per directory (GET /api/pr-phase), shown in the roster beside the
// agent status. Keyed by cwd, not session — the phase is the branch's, so cells sharing a dir
// share one fetch. Best-effort and cached server-side, so the roster poll can re-fetch cheaply.
const phaseByCwd = reactive(new Map<string, PrPhase>());
const latestPhaseSeed = new Map<string, number>();
async function seedPhase(cwd: string) {
  const seed = (latestPhaseSeed.get(cwd) ?? 0) + 1;
  latestPhaseSeed.set(cwd, seed);
  try {
    const res = await fetch(`/api/pr-phase?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok || latestPhaseSeed.get(cwd) !== seed) return;
    const d = (await res.json()) as { phase?: unknown };
    if (latestPhaseSeed.get(cwd) !== seed) return;
    if (isPrPhase(d.phase)) {
      // Before the set, so the previous value is still the one to compare against.
      if (becameCiFailing(phaseByCwd.get(cwd), d.phase)) notifySound("pr-ci-failed", cwd);
      phaseByCwd.set(cwd, d.phase);
    }
  } catch {
    // best-effort — the next poll retries
  }
}
// Drop what no cell asks for any more, so a day of relaunching cells doesn't leave an entry
// behind for every session the grid ever showed.
// The directory chrome each roster row is tinted with — its configured header colour, so
// a row reads as the same directory as its terminal's header. Keyed by cwd (the config is
// the directory's, like the phase), fetched through the shared dir-config cache.
type RowChrome = { headerColor: string | null; headerTextColor: string | null };
const chromeByCwd = reactive(new Map<string, RowChrome>());
// A freshness token per cwd, exactly like latestPhaseSeed: two rapid dir-config edits can
// leave fetches resolving out of order, and without this a stale one would overwrite the
// newer colour.
const latestChromeSeed = new Map<string, number>();
async function seedChrome(cwd: string) {
  const seed = (latestChromeSeed.get(cwd) ?? 0) + 1;
  latestChromeSeed.set(cwd, seed);
  const config = await fetchDirConfig(cwd);
  if (latestChromeSeed.get(cwd) !== seed) return; // a newer seed for this cwd already won
  chromeByCwd.set(cwd, { headerColor: config.headerColor, headerTextColor: config.headerTextColor });
}
const refreshAllChrome = () => {
  const cwds = new Set(state.value.cells.map((c) => c.cwd).filter((c): c is string => c !== null));
  cwds.forEach((cwd) => void seedChrome(cwd));
};
// A user editing .mulmoterminal.json is announced on the dir-config channel; re-fetch that
// directory's chrome so an open roster recolours without a reload. The unsubscribe is kept
// and called on unmount so a remounted grid doesn't stack duplicate handlers.
const cwdOf = (data: unknown): string | null =>
  typeof data === "object" && data !== null && typeof (data as { cwd?: unknown }).cwd === "string" ? (data as { cwd: string }).cwd : null;
const unsubscribeDirConfig = usePubSub().subscribe("dir-config", (data) => {
  const cwd = cwdOf(data);
  if (cwd) {
    invalidateDirConfig(cwd);
    void seedChrome(cwd);
  }
});
onBeforeUnmount(unsubscribeDirConfig);

const forgetClosedCells = () => {
  const sessions = new Set(state.value.cells.map((c) => c.session).filter((s): s is string => !!s));
  const cwds = new Set(state.value.cells.map((c) => c.cwd).filter((c): c is string => c !== null));
  staleCacheKeys(sessionMeta.keys(), sessions).forEach((id) => {
    sessionMeta.delete(id);
    latestMetaSeed.delete(id);
  });
  staleCacheKeys(phaseByCwd.keys(), cwds).forEach((cwd) => {
    phaseByCwd.delete(cwd);
    latestPhaseSeed.delete(cwd);
  });
  staleCacheKeys(chromeByCwd.keys(), cwds).forEach((cwd) => {
    chromeByCwd.delete(cwd);
    latestChromeSeed.delete(cwd);
  });
};

// This watch runs whether or not the roster is on screen, and it is what fills sessionMeta,
// so the cleanup has to hang off it too — pruning only on the roster poll leaves the cache
// growing for anyone who never opens the roster.
// Keyed on the cwd as well as the session: a cell that keeps its session and only moves
// directory still retires a phaseByCwd entry, and the roster may be hidden for hours.
watch(
  () => rosterCellsKey(state.value.cells),
  () => {
    forgetClosedCells();
    refreshAllMeta();
  },
  { immediate: true },
);

const refreshAllPhases = () => {
  const cwds = new Set(state.value.cells.map((c) => c.cwd).filter((c): c is string => c !== null));
  cwds.forEach((cwd) => void seedPhase(cwd));
};

const refreshRoster = () => {
  forgetClosedCells();
  refreshAllMeta();
  refreshAllPhases();
  refreshAllChrome();
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
// The header's view toggle (shown only while zoomed) flips roster / thumbnail strip; the poll
// follows since the roster is its sole consumer.
const toggleListMode = () => {
  listModeOn.value = !listModeOn.value;
  syncPoll();
};
// Follows the ROUTE, not the lifecycle. The grid is the only view now, so it is mounted for the
// life of the page and never deactivates — but it still goes off screen under a full-screen
// overlay, and polling the roster nobody can see is the same waste the deactivate hook used to
// avoid.
watch(onTerminalsRoute, (onGrid) => (onGrid ? startPoll() : stopPoll()), { immediate: true });
onBeforeUnmount(stopPoll);

// A cell with no session/prompt yet still gets a human label from what it IS running.
const fallbackLabel = (c: Cell): string | null => c.command?.label ?? c.launcher?.label ?? (c.session ? "starting…" : "empty");
// "Nothing known yet" is resolved ONCE per lookup rather than per field. Five of the row's fields
// come out of the meta and two out of the chrome, so a `??` on each both crossed the complexity
// limit and made every field independently defaultable — which is how a field the roster never
// wired up reads as a legitimate null rather than failing to typecheck.
const chromeOf = (cwd: string | null): RowChrome => (cwd ? chromeByCwd.get(cwd) : undefined) ?? { headerColor: null, headerTextColor: null };
const rosterRow = (c: Cell): CockpitRow => {
  const meta = (c.session ? sessionMeta.get(c.session) : undefined) ?? EMPTY_SESSION_META;
  const chrome = chromeOf(c.cwd);
  return {
    uid: c.uid,
    cwd: c.cwd,
    agent: c.agent ?? "claude",
    status: statusForSort.value[c.uid] ?? "idle",
    memo: meta.memo,
    summary: meta.aiTitle,
    prompt: meta.lastPrompt,
    response: meta.lastResponse,
    fallback: fallbackLabel(c),
    phase: (c.cwd ? phaseByCwd.get(c.cwd) : undefined) ?? ("none" as PrPhase),
    workPhase: meta.workPhase,
    headerColor: chrome.headerColor,
    headerTextColor: chrome.headerTextColor,
    parked: c.parked === true,
  };
};
const listRows = computed(() => orderedCells.value.map(rosterRow));
// The cancelable trailing launch cell's uid (null when there's nothing to cancel):
// drives both the toolbar's cancel state and the launcher's in-cell close button.
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
const onAgent = (uid: number, agent: TerminalAgent) => (state.value = setCellAgent(state.value, uid, agent));
const onPark = (uid: number, parked: boolean) => (state.value = setCellParked(state.value, uid, parked));
// Pass the on-screen order so closing the zoomed cell stays zoomed on its filmstrip
// neighbour (previous, or next when it was the first) instead of collapsing the grid.
const onClose = (uid: number) =>
  (state.value = closeCell(
    state.value,
    uid,
    displayCells.value.map((c) => c.uid),
  ));
// Pass the on-screen order so releasing the zoom lands on the page holding the cell that was
// enlarged — including when the user got there by clicking a roster row or filmstrip thumbnail,
// which changes what is zoomed without touching the page.
const onToggleExpand = (uid: number) =>
  (state.value = toggleExpand(
    state.value,
    uid,
    orderedCells.value.map((c) => c.uid),
  ));
const onRun = (uid: number, command: RunCommand) => (state.value = runCommand(state.value, uid, command));
// A running cell's header Run menu: launch in a spare cell (next to it) so the session survives.
const onRunSpare = (uid: number, command: RunCommand) => (state.value = runScriptInNewCell(state.value, uid, command));
// The empty cell launcher picked a program — a configured launch command, or the OS default
// shell: turn it into a persistent launcher cell. Its session id arrives later via onSession.
const onLaunch = (uid: number, pick: LaunchPick) => (state.value = launchInCell(state.value, uid, pick.launcher, pick.cwd));
const onMove = (uid: number, dir: -1 | 1) => (state.value = moveCell(state.value, uid, dir));
const toggleSortMode = () => (state.value = setSortMode(state.value, nextSortMode(state.value.sortMode)));
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
// Registered for the life of the component: with the single view gone there is no other grid to
// mutate by mistake, and openTerminalAt brings this one on screen itself when an overlay is over
// it (#1193). The queue in useNewTerminal still covers the window before this mounts.
const SLOT_UID_RE = /^cell-(\d+)$/;
let offNewTerminal: (() => void) | null = null;
// Each kind is already expressible as a cell: a shell is a shell launcher, a non-Claude agent is
// marked with `agent`, and Claude is the plain default. The session id arrives from the server once
// the cell opens its socket, so they all persist and reconnect like any other cell.
//
// A Record over LAUNCH_AGENTS rather than an if-chain: the chain ended in `shellCell`, so adding an
// agent to that list without a case here silently opened a SHELL under its name. Now it does not
// compile.
const CELL_FOR_AGENT: Record<LaunchAgent, (cwd: string) => Omit<Cell, "uid">> = {
  shell: (cwd) => shellCell(cwd),
  claude: (cwd) => ({ session: null, cwd }),
  codex: (cwd) => ({ session: null, cwd, agent: "codex" }),
  antigravity: (cwd) => ({ session: null, cwd, agent: "antigravity" }),
};
const cellForAgent = (cwd: string, agent: LaunchAgent | undefined): Omit<Cell, "uid"> => (agent ? CELL_FOR_AGENT[agent](cwd) : shellCell(cwd));

const openNewTerminal = ({ cwd, afterSlotKey, agent }: NewTerminalRequest) => {
  const match = afterSlotKey?.match(SLOT_UID_RE);
  const afterUid = match ? Number(match[1]) : NO_ORIGIN_UID;
  state.value = insertCellAfter(state.value, afterUid, cellForAgent(cwd, agent));
};
const detachNewTerminal = () => {
  offNewTerminal?.();
  offNewTerminal = null;
};
onMounted(() => (offNewTerminal = registerNewTerminalHandler(openNewTerminal)));
onBeforeUnmount(detachNewTerminal);

// Server config: the default workspace dir + the auto-recorded dir presets + sound.
const { defaultCwd, home, presets, launchers, loadConfig, recordPreset, removePreset } = useAppConfig();
const showSettings = ref(false);
onMounted(loadConfig);

function closeSettings() {
  showSettings.value = false;
}

// Page Up / Page Down walk the zoom between terminals (#829). Listened for on `window` in the
// CAPTURE phase because xterm binds keydown on its own textarea: capture runs first, so the
// key can be claimed before the terminal turns it into a page-forward escape sequence.
function onShortcutKey(e: KeyboardEvent) {
  // Only while the grid is what the user is actually LOOKING at. It now stays mounted underneath a
  // full-screen overlay, so without this a keystroke aimed at the collection browser or the wiki
  // reaches the hidden grid — up to `terminal-close` closing its zoomed cell. CodeMirror is the
  // worst of it: its editable surface is contenteditable, which isEditableTarget below does not
  // exclude, so typing in an editor was reaching the shortcuts (Codex, PR #1193).
  if (!onTerminalsRoute()) return;
  if (showSettings.value) return;
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (target && isEditableTarget(target.tagName, Array.from(target.classList))) return;
  const shortcut = gridShortcutFor(getActiveKeymap(), e, expandedUid.value !== null);
  if (!shortcut) return;
  e.preventDefault();
  e.stopPropagation();
  runShortcut(shortcut);
}

// gridShortcutFor has already refused the actions that need a terminal to act ON while
// un-zoomed. The ones that reach here un-zoomed are the ways IN: `terminal-new`, plus
// `zoom-toggle` / `next-attention`, which pick the cell to enlarge themselves.
function runShortcut(shortcut: GridShortcut) {
  // The FULL ordered list, not `displayCells` — which un-zoomed is only the current page.
  // Both matter: these helpers derive `page` from the index, so a page slice would send an
  // entry action to page 0 from any other tab, and `next-attention` could not reach a cell
  // calling from another page even though the toolbar counts those.
  const order = orderedCells.value.map((c) => c.uid);
  const uid = expandedUid.value;
  if (shortcut === "zoom-next" || shortcut === "zoom-prev") {
    state.value = moveZoom(state.value, order, shortcut === "zoom-next" ? 1 : -1);
  } else if (shortcut === "zoom-toggle") {
    const wasZoomed = expandedUid.value;
    state.value = toggleZoom(state.value, order, focusedCellUid.value);
    // Keep the cursor on the same terminal through both directions: enlarging focuses the cell
    // that was selected, collapsing focuses the one that WAS enlarged, so the grid selection is
    // where the user just was instead of wherever focus happened to be before.
    const target = expandedUid.value ?? wasZoomed;
    if (target !== null) void nextTick(() => conn.focus(`cell-${target}`));
  } else if (shortcut === "next-attention") {
    // Focus the terminal it moves to, not just the state. In a plain grid nothing else shows
    // WHICH cell was picked — the focused cell lifts, and the cursor lands where the user is
    // being sent, so the next thing they type goes to the terminal that called them.
    const target = nextAttentionUid(state.value, order, statusForSort.value, focusedCellUid.value);
    state.value = nextAttention(state.value, order, statusForSort.value, focusedCellUid.value);
    if (target !== null) void nextTick(() => conn.focus(`cell-${target}`));
  } else if (shortcut === "terminal-new") {
    onAddTerminal();
  } else if (shortcut === "terminal-new-adjacent" && uid !== null) {
    state.value = insertCellAfter(state.value, uid, shellCell(adjacentCwd(uid)));
  } else if (shortcut === "terminal-close" && uid !== null) {
    onClose(uid);
  }
}

// The dir a new adjacent terminal opens in: the one the current terminal is running in, which
// is what "split this terminal" means everywhere else. Falling back through preferredLaunchDir
// rather than straight to defaultCwd keeps this on the SAME rule the launch form uses — it also
// tries the most recent cwd preset, which a cell with no recorded dir would otherwise skip.
const adjacentCwd = (uid: number): string =>
  preferredLaunchDir({
    initialCwd: state.value.cells.find((c) => c.uid === uid)?.cwd,
    presets: presets.value,
    defaultCwd: defaultCwd.value,
  });
useCaptureKeydown(onShortcutKey);

// Launch a Settings skill in a new auto-running session and show it as a GRID CELL. The button was
// pressed in the grid's own Settings, so answering it by switching to the single view reads as the
// app losing your place — you came back to a different screen than the one you left.
//
// Spawned first, then adopted: the spawn route is the only way to seed a first turn (a plain claude
// cell has no channel to be handed a prompt). The cell attaches to the session it is given, which
// is the same path a reload takes to reattach.
//
// No `hidden` here any more: it used to mean "don't let useChatLauncher select this in the single
// view", which was a workaround for the switch this now avoids by default. `hidden` keeps its own
// meaning on the server (a real background worker, background-chat.ts) and must not be reused for
// placement.
function launchSkill(skill: BundledSkillName) {
  closeSettings();
  void startCollectionChat(skillSeed(skill, "claude"));
}

// The grid component itself, for the one thing GridView drives that is not cell state: revealing
// a placed chat's Canvas (see placeChat).
const gridRef = ref<InstanceType<typeof TerminalGrid> | null>(null);

// Place an already-spawned chat as a cell. Every programmatically started chat arrives here —
// the collection UI's actions and template cards, custom views, the Settings skill buttons —
// via useChatLauncher's one choke point.
const placeChat = ({ id, agent, canvas }: SpawnedChatRequest): boolean => {
  // Already adopted — by the unplaced sweep below, or by an earlier request for the same session.
  // Two cells for one session fight over its socket: the server supersedes the prior one, so the
  // older cell goes dead while still looking live.
  if (state.value.cells.some((cell) => cell.session === id)) return true;
  // Seeded with the directory the server spawns these in (CLAUDE_CWD, which /api/config reports as
  // `cwd`); the cell adopts whatever the PTY reports anyway. sessionCell carries the agent, which
  // matters because a spawn follows the Claude/Codex/Antigravity toggle.
  const placed = insertCellAfter(state.value, NO_ORIGIN_UID, sessionCell(id, defaultCwd.value, agent));
  // A full grid (MAX_TERMINALS) drops the cell and insertCellAfter hands the state straight back.
  // Judged by identity AFTER the spawn, not by counting before it: the count can cross the cap
  // while the spawn is in flight, and then the answer taken earlier is wrong.
  //
  // It used to fall back to the single view; with that gone the session simply WAITS. Nothing is lost: the server
  // clears its unplaced mark only when a cell attaches, so the next load with room adopts it, and
  // the launcher's resume list shows it meanwhile. Reaching the cap at all now takes 81 terminals
  // opened by hand — hidden workers and scheduled tasks never take a cell.
  if (placed === state.value) {
    console.warn(`[grid] full (${MAX_TERMINALS} cells) — session ${id} is left waiting for room`);
    return false;
  }
  state.value = placed;
  // A collection is already waiting in this session's Canvas. The pane exists only beside an
  // ENLARGED cell, so a card in a tiled one is two gestures away and invisible until both are
  // made — which is how a seeded collection reads as a feature that does nothing. Reuses the
  // grid's own reveal (files-buffer flush included) rather than setting the two pieces of state
  // from here. Deliberately NOT done for an unseeded spawn: taking the screen to show an empty
  // pane is worse than leaving the grid as the user arranged it.
  if (canvas) {
    const uid = placed.cells.find((cell) => cell.session === id)?.uid;
    // After the state renders: the grid has to be showing the cell before it can enlarge it.
    if (uid !== undefined) void nextTick(() => gridRef.value?.openCanvasFor(uid));
  }
  return true;
};
// Sessions the SERVER spawned that no cell has taken — a scheduled task's chat, one the phone
// started, one an agent started from another session. The browser that asks for a chat places it
// itself (placeChat above); this is the other half, for when there was no browser at all.
//
// Asked on ACTIVATE rather than mount: the grid is kept alive across route changes, so mount fires
// once per page load and would miss everything spawned while the user was elsewhere in the app.
let adoptingUnplaced = false;
// A trigger that arrived mid-sweep and has to be answered once this one lands. Deferred, not
// DROPPED: the in-flight response was generated when the fetch was sent, so a session marked after
// that is not in it, and simply refusing the overlapping trigger would leave that session with no
// cell until a later route change or reload — the exact bug this whole path exists to fix (Codex,
// this PR). One flag rather than a count: every sweep asks for the whole list, so N deferred
// triggers and one are the same question.
let sweepAgain = false;
async function adoptUnplacedSessions(): Promise<void> {
  // One sweep at a time. The route watcher can fire again before the fetch resolves — leave the
  // grid for an overlay and come straight back — and both runs would read `cells` before either
  // inserted, so both would adopt the same session and give it two cells fighting over one socket.
  // The per-row guard below cannot catch that: it reads state neither call has written yet.
  if (adoptingUnplaced) {
    sweepAgain = true;
    return;
  }
  adoptingUnplaced = true;
  try {
    const res = await fetch("/api/sessions/unplaced");
    if (!res.ok) return;
    const body = (await res.json()) as { sessions?: { id?: unknown; agent?: unknown; cwd?: unknown }[] };
    for (const row of body.sessions ?? []) {
      if (typeof row?.id !== "string" || !row.id) continue;
      // Already here: the server clears the mark when a cell attaches, but this tab may still be
      // holding a cell whose attach has not landed yet — and adopting twice would give one session
      // two cells fighting over the same socket.
      if (state.value.cells.some((cell) => cell.session === row.id)) continue;
      const agent = asTerminalAgent(row.agent);
      const placed = insertCellAfter(state.value, NO_ORIGIN_UID, sessionCell(row.id, typeof row.cwd === "string" ? row.cwd : defaultCwd.value, agent));
      // A full grid drops the cell and hands the state straight back. Nothing to fall back to
      // here — this session has been waiting, and it can keep waiting: the mark is only cleared
      // by an attach, so the next load with room adopts it.
      if (placed === state.value) break;
      state.value = placed;
    }
  } catch {
    // Best effort: a grid that cannot ask still works, and the sessions stay marked for next time.
  } finally {
    adoptingUnplaced = false;
    // Whatever came in while this was in flight, asked now that the state it would have raced is
    // written. Not route-guarded again: the trigger passed that check when it ARRIVED, and the
    // grid stays mounted under an overlay anyway — the cell is simply there when the user returns.
    if (sweepAgain) {
      sweepAgain = false;
      void adoptUnplacedSessions();
    }
  }
}
// Driven by the ACTUAL route, not by activation. Since #1193 the grid stays mounted underneath a
// full-screen overlay, so opening PRs or the collection browser and coming back no longer
// deactivates and reactivates it — and a session spawned while the user was in there would sit
// without a cell until they switched to Chat and back, or reloaded (Codex, PR #1193). This fires
// on both: the first mount, and every return to /terminals from an overlay.
watch(
  onTerminalsRoute,
  (onGrid) => {
    if (onGrid) void adoptUnplacedSessions();
  },
  { immediate: true },
);
// ...and the same sweep on the PUSH, for a session spawned while the grid is already on screen:
// the phone's remote chat (index.ts remoteHostSpawnChat), a scheduled task, an agent spawning one
// from another session. The route watcher above only fires when the route CHANGES, so a user
// sitting on the grid — which is where they normally are — saw a live agent nowhere at all until
// they happened to open an overlay and come back, or reloaded.
//
// Only "created". The same channel carries every working/waiting/closed push, so sweeping on all
// of them would refetch many times a turn to learn nothing; the spawn is the one moment a session
// can become unplaced. A create that arrives while the user is elsewhere in the app needs nothing
// extra — the watcher adopts it on the way back.
const isSessionCreated = (data: unknown): boolean => typeof data === "object" && data !== null && (data as { event?: unknown }).event === "created";
const { subscribe: subscribeSessions, onReconnect } = usePubSub();
const unsubscribeSessions = subscribeSessions("sessions", (data) => {
  if (isSessionCreated(data) && onTerminalsRoute()) void adoptUnplacedSessions();
});
// pub/sub replays room membership on reconnect but not the events missed while disconnected, so a
// spawn during a dropped socket would never be swept — the same re-sync useSessions does.
const offReconnect = onReconnect(() => {
  if (onTerminalsRoute()) void adoptUnplacedSessions();
});
onBeforeUnmount(() => {
  unsubscribeSessions();
  offReconnect();
});

// Registered for the life of the component, like the new-terminal opener above and for the same
// reason: this is the only grid there is.
let offSpawnedChat: (() => void) | null = null;
const detachSpawnedChat = () => {
  offSpawnedChat?.();
  offSpawnedChat = null;
};
onMounted(() => (offSpawnedChat = registerSpawnedChatHandler(placeChat)));
onBeforeUnmount(detachSpawnedChat);
</script>

<template>
  <div class="flex flex-col h-screen w-screen overflow-hidden">
    <AppToolbar
      :add-terminal-active="launchOpen"
      :sort-mode="state.sortMode"
      :status-counts="statusCounts"
      :show-view-toggle="expandedUid !== null"
      :list-mode="listModeOn"
      @add-terminal="onAddTerminal"
      @toggle-sort="toggleSortMode"
      @toggle-view="toggleListMode"
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
      ref="gridRef"
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
      :list-mode="listModeOn"
      @session="onSession"
      @agent="onAgent"
      @park="onPark"
      @cwd="onCwd"
      @record-cwd="recordPreset"
      @remove-preset="removePreset"
      @close="onClose"
      @toggle-expand="onToggleExpand"
      @focus-cell="focusedCellUid = $event"
      @run="onRun"
      @run-spare="onRunSpare"
      @launch="onLaunch"
      @move="onMove"
      @status="onStatus"
    />
    <footer v-if="noRunningTerminals" class="flex-none border-t border-border bg-panel px-4 py-2 text-center">
      <GuideLinks />
    </footer>
    <AppSettingsModal v-if="showSettings" :presets="presets" @launch-skill="launchSkill" @close="closeSettings" />
  </div>
</template>
