<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onActivated, watch, nextTick, useTemplateRef } from "vue";
import TerminalCell from "./TerminalCell.vue";
import CommandCell from "./CommandCell.vue";
import LauncherCell from "./LauncherCell.vue";
import CockpitRowMenu from "./CockpitRowMenu.vue";
import CockpitHeader from "./CockpitHeader.vue";
import * as conn from "../composables/useTerminalConnections";
import { trackStyle, layoutForCount } from "./gridLayout";
import { cockpitLines } from "../composables/cockpitLines";
import { flipKeyframes, flipPairs, onScreen, FLIP_MS, FLIP_EASING } from "./cellFlip";
import { canMoveCell, type Cell } from "./gridTabs";
import type { AttentionStatus } from "./attentionStatus";
import type { RunCommand } from "./runCommand";
import type { PrPhase, WorkPhase } from "./rosterPhase";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";
import { shouldFlipZoom } from "./cellChromeRules";
import { rosterAlertClass } from "./rosterAlertClasses";
import { useRosterAlert } from "../composables/useRosterAlert";
import { formatCwd } from "./cwdDisplay";
import FilesPane, { type FilesPaneState } from "./FilesPane.vue";
import GuiPanel from "./GuiPanel.vue";
import ToolsPane from "./ToolsPane.vue";
import {
  clampPaneWidth,
  clampSecondary,
  splitterKeySize,
  splitterKeyWidth,
  MIN_GUI,
  MIN_ROSTER,
  MIN_STRIP,
  MIN_TERMINAL,
  MIN_TERMINAL_HEIGHT,
  TERMINAL_STRIP,
} from "./splitterWidth";
import { setFilesPaneOpener } from "../composables/filesPaneOpener";
import { paneCanShowClick } from "./paneClickTarget";
import { onToolGroupsAnnounced } from "../composables/useToolGroupsAnnounce";
import { usePubSub } from "../composables/usePubSub";
import { getPlugin } from "../plugins-registry";
import { isRecord } from "../../common/isRecord";
import { hasCanvasGroup } from "../../common/toolGroups";
import type { RightPane } from "./gridCell";
import { parsePaneStore, rememberPane, recallPane } from "./filesPaneStore";
import type { TerminalAgent } from "../../common/sessionAgent";

// Renders the grid, auto-sized to the cell count, fully controlled by GridView:
// `cells` is the active page's slice (≤9) when nothing is zoomed, and `expandedUid`
// the zoomed cell; every change is emitted up by uid.
// Expanding a cell switches to a filmstrip — the zoomed cell (teleported to the
// overlay) fills the top, the rest line up in a scrollable strip below. While
// zoomed, GridView passes EVERY cell (all tabs), so the strip shows them all live.
// A cell carrying a `command` renders as a CommandCell (a running script.json
// command) instead of the Claude launcher/terminal.
export interface CockpitRow {
  uid: number;
  cwd: string | null;
  agent: string;
  status: AttentionStatus;
  memo: string | null; // the user's own one-line note (#1084)
  summary: string | null; // AI title
  prompt: string | null; // current user prompt
  response: string | null; // tail of the agent's latest reply
  fallback: string | null; // label when there's no prompt/summary yet (launcher/command name)
  phase: PrPhase; // the branch's PR workflow phase (`none` until a PR exists)
  workPhase: WorkPhase | null; // planning vs editing while working; null when unknown / not working
  headerColor: string | null; // the directory's configured header background, tinting the row
  headerTextColor: string | null; // and its text colour, so the row stays legible on that tint
  parked: boolean; // set aside by the user (#992) — the row sinks, unless it is blocked
}
const props = defineProps<{
  cells: Cell[];
  expandedUid: number | null;
  // A text row per cell for the cockpit list shown beside the expanded terminal.
  listRows: CockpitRow[];
  cancelUid: number | null;
  defaultCwd: string | null;
  presets: CwdPreset[];
  launchers: Launcher[];
  home: string | null;
  // Manual sort mode: each cell shows move buttons to reorder.
  reorderable?: boolean;
  openSessionIds: string[];
  openCwds: string[];
  // While a cell is zoomed: cockpit roster (true) vs thumbnail strip (false). Owned by GridView
  // so the toggle can live in the global toolbar rather than float over the stage.
  listMode: boolean;
}>();
const emit = defineEmits<{
  (e: "session" | "cwd", uid: number, value: string): void;
  (e: "close" | "toggle-expand" | "focus-cell", uid: number): void;
  (e: "run" | "runSpare", uid: number, command: RunCommand): void;
  (e: "launch", uid: number, pick: LaunchPick): void;
  (e: "move", uid: number, dir: -1 | 1): void;
  (e: "status", uid: number, value: AttentionStatus): void;
  (e: "agent", uid: number, value: TerminalAgent): void;
  (e: "park", uid: number, value: boolean): void;
  // Shared preset list events — uid-less since they mutate the one config list.
  (e: "record-cwd" | "remove-preset", value: string): void;
}>();

const gridStyle = computed(() => trackStyle(layoutForCount(props.cells.length)));

// Whether a roster row that is waiting on the user blinks (#1131). The row's amber stays either
// way; this is only the motion.
const { blink: rosterBlink } = useRosterAlert();

// The keyboard-focused cell, so it can lift + zoom slightly in place. `focusin` bubbles from the
// xterm textarea up to the grid, so one delegated listener suffices. It's sticky: focus moving to
// the toolbar doesn't reset it — only another cell taking focus moves the emphasis.
const focusedUid = ref<number | null>(null);
function onFocusIn(e: FocusEvent) {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const el = target.closest<HTMLElement>("[data-uid]");
  if (!el?.dataset.uid) return;
  focusedUid.value = Number(el.dataset.uid);
  // GridView needs it too: un-zoomed it is the only "which terminal am I on" there is, and the
  // keyboard shortcuts rotate from it.
  emit("focus-cell", focusedUid.value);
}

// Returning to the grid via a top-tab switch reactivates it under <KeepAlive>, which does
// NOT re-run the cells' attach()/focus() — so nothing restores the cursor. Put it back in
// whichever cell last held it (sticky `focusedUid`, tracked in both the grid and the
// zoomed slot). Grid cells' durable connections are keyed `cell-<uid>`.
onActivated(() => {
  const uid = focusedUid.value;
  if (uid !== null) nextTick(() => conn.focus(`cell-${uid}`));
});
// Per-cell class: `flipping` drives the zoom FLIP, `focused` the in-place lift of the active cell —
// suppressed while expanded or mid-flip so it never fights those animations.
function cellClass(uid: number) {
  return {
    flipping: flippingUids.value.has(uid),
    focused: uid === focusedUid.value && props.expandedUid === null && !flippingUids.value.has(uid),
  };
}
// Hand the flip's timing to the stylesheet so the fade under it can't drift out of sync.
const flipVars = { "--flip-ms": `${FLIP_MS}ms`, "--flip-ease": FLIP_EASING };

// The zoomed cell is teleported up here; the target must exist before it moves, so
// hold off until mounted (covers a reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));
const zoomed = computed(() => props.expandedUid !== null && mounted.value);

// The file pane beside the enlarged cell. ONE pane, not one per cell: it re-roots to whichever
// cell is enlarged, so walking the zoom doesn't accumulate editors. Open-state and width are
// per-browser (localStorage), like the single view's splitter and the terminal font size.
const PANE_OPEN_KEY = "files_pane_open";
const PANE_WIDTH_KEY = "files_pane_width";
// What each directory had open, so a reload lands back on the file rather than the tree root (#958).
const PANE_STATE_KEY = "files_pane_state";
const PANE_WIDTH_DEFAULT = 480;
// Storage can throw (private mode / storage-blocked contexts), so both reads are best-effort.
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the pane still works this session, it just isn't remembered
  }
};
// Which pane holds the one slot beside the enlarged terminal (see gridCell.ts):
//   files  — the file tree/editor (the original occupant).
//   canvas — what the agent DREW: the GUI plugin views for this cell's session.
//   tools  — which GUI tools this session actually has, read-only.
const isRightPane = (value: string | null): value is RightPane => value === "files" || value === "canvas" || value === "tools";
// The key used to hold a boolean, where "1" meant the files pane was open — so an existing
// browser is migrated rather than silently starting closed.
function restoredPane(value: string | null): RightPane | null {
  if (isRightPane(value)) return value;
  return value === "1" ? "files" : null;
}
const rightPane = ref<RightPane | null>(restoredPane(stored(PANE_OPEN_KEY)));
const filesOpen = computed(() => rightPane.value === "files");
const paneWidth = ref(Number(stored(PANE_WIDTH_KEY)) || PANE_WIDTH_DEFAULT);
const zoomRow = ref<HTMLElement | null>(null);
// A separator is `flex-none` and belongs to NEITHER side, so counting its 5px as usable is how a
// terminal ends up just under its floor. Subtracted from every space a splitter divides.
const SEPARATOR_PX = 5;
// The pane keeps its 1px left border even with its content squeezed to nothing, so that pixel
// exists for as long as the pane is open and is not the terminal's to spend either.
const PANE_CHROME_PX = SEPARATOR_PX + 1;
const rowWidth = () => Math.max(0, (zoomRow.value?.clientWidth ?? 0) - (rightPane.value ? PANE_CHROME_PX : 0));
// Mirrored into a ref so the separator can announce its range (a plain function call would not
// re-render when the row resizes). The pane's floor gives way to the terminal's on a narrow row,
// which is why the minimum is itself clamped.
const rowWidthNow = ref(0);
const paneMax = computed(() => Math.max(0, rowWidthNow.value - MIN_TERMINAL));
const paneMin = computed(() => Math.min(MIN_GUI, paneMax.value));

function setFilesOpen(open: boolean): void {
  setRightPane(open ? "files" : null);
}

// Switching panes is the same event as closing the files one, because the files pane unmounts
// either way — so its buffer has to be saved on both paths, not just on close.
function setRightPane(pane: RightPane | null): void {
  const leavingFiles = filesOpen.value && pane !== "files";
  if (leavingFiles) rememberPaneState(paneUid.value);
  rightPane.value = pane;
  // Leaving files drops the cell it was on, so coming back lands on whichever cell is enlarged
  // THEN rather than resuming a directory the user has since walked away from.
  if (leavingFiles) {
    paneCwd.value = null;
    paneUid.value = null;
  }
  remember(PANE_OPEN_KEY, pane ?? "");
}

// The header toggle. Closing unmounts the pane, buffer and all, so the buffer is saved on the
// way out — the pane's OWN close button has already flushed by the time it emits, which is why
// that path stays separate rather than routing through here.
async function toggleFiles(): Promise<void> {
  await toggleRightPane("files");
}

// The unread-canvas chip on a tiled cell: enlarge that cell AND put the pane beside it, in one
// click. Two steps because the pane only exists while a cell is enlarged — asking the user to
// expand first and then find the button is the gesture this chip exists to remove.
//
// Also exposed (below) for a chat placed with a collection already seeded into its Canvas: same
// two steps, same reason, just nobody clicking. It stays ONE function because "reveal this cell's
// canvas" has to mean the same thing however it is reached — including the files-buffer flush,
// which a second implementation would be the natural place to forget.
//
// `enlarge` is the one thing the callers disagree about, and it matters only because the flush
// above is ASYNC. A click on the chip means "bring that cell here", so a zoom that moved while the
// buffer was being saved must still end on the cell that was asked for. The agent drawing on the
// cell you are looking at means "put it beside what is already there" — if the user has walked the
// zoom away in the meantime, enlarging the drawing cell back would be exactly the takeover that
// case refuses to do, so it gives up instead. Caught by Codex on PR #1227.
async function openCanvasFor(uid: number, enlarge = true): Promise<void> {
  if (filesOpen.value && (await filesPane.value?.flush()) === false) return;
  if (props.expandedUid !== uid) {
    if (!enlarge) return;
    emit("toggle-expand", uid);
  }
  setRightPane("canvas");
}

// GridView drives this one from OUTSIDE a user gesture (placing a spawned chat whose Canvas is
// already seeded). The pane is TerminalGrid's own state — GridView owns the cells, not what sits
// beside them — so this is the seam rather than another prop to watch.
defineExpose({ openCanvasFor });

// A pane button: opens its pane, or closes it when it is already the one showing.
async function toggleRightPane(pane: RightPane): Promise<void> {
  // Leaving files unmounts the buffer with the pane, so a buffer that could be neither saved
  // nor backed up keeps it open — the error is visible in it. Checked whichever pane was asked
  // for: files unmounts when another pane takes the slot exactly as it does when closed.
  if (filesOpen.value && (await filesPane.value?.flush()) === false) return;
  setRightPane(rightPane.value === pane ? null : pane);
}

// The enlarged cell's project dir — what the pane browses. A cell that hasn't reported one yet
// (a launcher, a session still starting) falls back to the grid's default.
const expandedCwd = computed(() => props.cells.find((c) => c.uid === props.expandedUid)?.cwd ?? props.defaultCwd);

// The enlarged cell's session — what Canvas and Tools read. Null for a cell with no session
// yet (a launcher, a command cell), which both panes already render as empty.
const expandedSessionId = computed(() => props.cells.find((c) => c.uid === props.expandedUid)?.session ?? null);

// A drawing that lands on the cell you are already looking at opens the Canvas by itself. The
// agent calling presentDocument IS its answer to what was asked; with the pane closed that answer
// left no trace but a count on a chip, which reads as a notification rather than as the reply, and
// the user had to know that a pane exists and which button opens it.
//
// Scoped to the ENLARGED cell, deliberately. A background cell drawing must NOT seize the screen
// away from whatever is being done in another one, so that case keeps exactly what it has today:
// TerminalCell's unseen-canvas chip, which enlarges and opens on click. Owner's call.
//
// It re-opens every time, including after the user closed the pane by hand: closing is how you
// dismiss the drawing in front of you, not a standing preference against the next one.
const { subscribe: subscribeSession } = usePubSub();
let unsubscribeDrawn: (() => void) | undefined;

// Only a result that will actually RENDER counts. Every GUI tool result publishes on this channel,
// including ones with no view of their own (manageCollection, google) — taking over the pane for
// those would be a switch with nothing behind it to explain itself. Same question the panel asks
// before rendering a card, so the two cannot disagree about what "drew something" means.
function isDrawnResult(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return typeof data.toolName === "string" && Boolean(getPlugin(data.toolName));
}

watch(
  expandedSessionId,
  (sessionId) => {
    unsubscribeDrawn?.();
    unsubscribeDrawn = undefined;
    if (!sessionId) return;
    unsubscribeDrawn = subscribeSession(`session:${sessionId}`, (data) => {
      if (rightPane.value === "canvas" || props.expandedUid === null) return;
      if (!isDrawnResult(data)) return;
      // Through openCanvasFor rather than setRightPane: the files pane has a buffer to flush on
      // the way out and may refuse to go, and "reveal this cell's canvas" stays one function
      // however it is reached. Never enlarging (see there): a zoom the user moved while that
      // flush was running is theirs to keep.
      void openCanvasFor(props.expandedUid, false);
    });
  },
  { immediate: true },
);
onBeforeUnmount(() => unsubscribeDrawn?.());

// GUI -> LLM for the enlarged cell (a submitted form's answer). App.vue routes this through the
// single view's Terminal ref; here the slot key is derivable from the uid, so the connection
// runtime can be addressed directly rather than threading a component ref through the Teleport.
function sendToExpandedCell(text: string): boolean {
  return props.expandedUid === null ? false : conn.submitText(`cell-${props.expandedUid}`, text);
}

// Does the enlarged cell's session have the drawing tools? Only the server knows: a grid cell
// reaches them through the user's own per-folder MCP config, and the server learns which groups
// a session has from the URLs it connects to.
//
// Re-asked on every expand, not only when the session id changes: a cell that has just started
// may not have connected its MCP client yet, and re-expanding is how a user retries anything.
const canvasAvailable = ref(false);
// Whether the answer above has come back yet for the CURRENT cell. Without it the panel says
// "not enabled for this session" for the moment between switching cells and the reply landing
// — a wrong explanation is worse than none, so nothing is claimed until it is known.
const canvasChecked = ref(false);
watch(
  [expandedSessionId, () => props.expandedUid],
  async ([sessionId]) => {
    canvasAvailable.value = false;
    canvasChecked.value = false;
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/tools?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      // Late reply for a cell we have since walked away from would show the wrong button.
      if (sessionId !== expandedSessionId.value) return;
      // The GROUPS, not the tool names. Every cell here is a grid cell, so "has a canvas group"
      // is the whole question — and matching on a `present*` prefix would count
      // presentCollection, which belongs to `data` and draws nothing without the collection
      // store behind it.
      canvasAvailable.value = hasCanvasGroup(body.groups);
      canvasChecked.value = true;
    } catch {
      // Unreachable server: no button rather than one that opens an empty panel. Left unchecked
      // so the panel does not blame the session for what is our own failure to ask.
      if (sessionId === expandedSessionId.value) canvasAvailable.value = false;
    }
  },
  { immediate: true },
);

// The answer above is normally asked BEFORE it can be true: the browser is handed a session id
// while claude is still being spawned, so its MCP client has not connected yet. Waiting for the
// server to say so is what stops that first "no" from standing until the user collapses and
// re-expands the cell.
onToolGroupsAnnounced((announcement) => {
  if (announcement.sessionId !== expandedSessionId.value) return;
  // Only the announcement that actually carries groups says anything about them; the bare
  // "my MCP client is up" one is a cue to ask again, not an empty answer.
  if (!announcement.groups) return;
  canvasAvailable.value = hasCanvasGroup(announcement.groups);
  canvasChecked.value = true;
});

// What EVERY cell type gets from the grid, whatever it is running — GridCellProps and
// GridCellEmits are already the shared contract in types, and the template used to re-spell both
// once per cell type. Bound as objects so the three cannot drift: a prop added to the contract and
// forgotten in one branch is a cell that quietly behaves differently from its neighbours.
//
// Deliberately NOT here: `uid` / `session` / `command` / `cwd`, which differ per cell type, and
// `@session`, which CommandCell does not declare (Vue warns about a listener no component emits).
const gridCellProps = (cell: Cell) => ({
  "data-uid": cell.uid,
  class: cellClass(cell.uid),
  expanded: cell.uid === props.expandedUid,
  filesOpen: filesOpen.value,
  rightPane: rightPane.value,
  canvasAvailable: canvasAvailable.value,
  zoomed: zoomed.value,
  home: props.home,
  reorderable: props.reorderable ?? false,
});
const gridCellEvents = (cell: Cell) => ({
  "toggle-expand": () => emit("toggle-expand", cell.uid),
  "toggle-files": toggleFiles,
  "toggle-canvas": () => toggleRightPane("canvas"),
  "open-canvas": () => openCanvasFor(cell.uid),
  "toggle-tools": () => toggleRightPane("tools"),
  close: () => emit("close", cell.uid),
  move: (dir: -1 | 1) => emit("move", cell.uid, dir),
  status: (value: AttentionStatus) => emit("status", cell.uid, value),
});

// What the Canvas pane should say instead of its "ask Claude to draw something" hint. The pane
// outlives the cell it was opened on, so walking the zoom lands it on cells that can never fill
// it — a launcher or a command cell (no session), or a directory with no render MCP.
const canvasUnavailable = computed<"no-session" | "no-canvas-mcp" | null>(() => {
  if (!expandedSessionId.value) return "no-session";
  if (canvasChecked.value && !canvasAvailable.value) return "no-canvas-mcp";
  return null;
});
const filesPane = ref<InstanceType<typeof FilesPane> | null>(null);
// What the pane looked like in each cell, so coming back to a terminal doesn't mean opening
// the same three directories again. Saved state only — the buffer went to disk on the way out
// (or to the backup store), so there is nothing unsaved to carry.
//
// Keyed by uid, which is right for a live session and useless across a reload: the number is
// not the same one afterwards. So a SECOND copy goes to localStorage keyed by directory
// (#958). Reads are memory-first, which leaves everything about a live session unchanged —
// the directory layer only answers when this map is empty, i.e. the first look after a reload.
const paneStateByUid = new Map<number, FilesPaneState>();
const rememberPaneState = (uid: number | null): void => {
  const snapshot = uid !== null ? filesPane.value?.snapshot() : undefined;
  if (uid === null || !snapshot) return;
  paneStateByUid.set(uid, snapshot);
  // Filed under the directory the pane is ACTUALLY on, which is what it will be looked up by.
  if (paneCwd.value) remember(PANE_STATE_KEY, JSON.stringify(rememberPane(parsePaneStore(stored(PANE_STATE_KEY)), paneCwd.value, snapshot)));
};

// A remembered directory is handed out at most ONCE per session. It describes what was on
// screen before the reload — not a default for every cell that happens to share the directory.
// Two terminals in the same repository is the ordinary case here, and without this the second
// one would inherit the first one's open file instead of starting on its own empty tree.
const claimedCwds = new Set<string>();

/** What to hand the pane for this cell: what it had this session, else — once — what this
 *  directory had before the reload. */
const claimPaneState = (uid: number | null, cwd: string | null): FilesPaneState | null => {
  const thisSession = paneStateByUid.get(uid ?? -1);
  if (thisSession) return thisSession;
  if (!cwd || claimedCwds.has(cwd)) return null;
  claimedCwds.add(cwd);
  return recallPane(parsePaneStore(stored(PANE_STATE_KEY)), cwd);
};
const paneState = ref<FilesPaneState | null>(null);
// The root the pane is ACTUALLY on. Normally `expandedCwd`, but it stays behind when a re-root
// is declined over unsaved edits — and it, not `expandedCwd`, is what the pane is handed, so a
// file opened from a tree that stayed put still resolves against the directory it came from.
const paneCwd = ref<string | null>(null);
// Which cell the pane is showing — the identity everything else hangs off. The UID rather than
// the directory: two terminals in the same repository is the ordinary case here, and keying on
// the directory would leave the pane bound to the cell it started on while the zoom moved to
// its neighbour. It also trails `expandedUid` when a re-root could not be saved out of, so a
// snapshot is filed under the cell the pane is on rather than the one it failed to reach.
const paneUid = ref<number | null>(null);

// Walking the zoom to another terminal has to re-root the pane: the pane deliberately ignores
// its `cwd` prop (see its defineExpose contract), so nothing else would move it. The buffer is
// saved first rather than asked about — the zoom moves from keys and filmstrip clicks, and a
// dialog on each of those would interrupt the very flow the pane is meant to sit beside.
watch(
  [filesOpen, zoomed, () => props.expandedUid, expandedCwd],
  async ([open, isZoomed, uid]) => {
    if (!open || !isZoomed) return;
    // Nothing moved: same cell, and it still reports the same directory.
    if (paneUid.value === uid && paneCwd.value === expandedCwd.value) return;
    // First showing: the pane is about to mount against this cell, so there is nothing to re-read.
    if (paneUid.value === null) {
      paneUid.value = uid;
      paneCwd.value = expandedCwd.value;
      paneState.value = claimPaneState(uid, expandedCwd.value);
      return;
    }
    // Re-rooting re-reads the tree and drops the buffer with it. Nothing to fall back on means
    // staying put: the pane keeps the cell and root it is on, which its header names.
    if ((await filesPane.value?.flush()) === false) return;
    rememberPaneState(paneUid.value);
    paneUid.value = uid;
    paneCwd.value = expandedCwd.value;
    paneState.value = claimPaneState(uid, expandedCwd.value);
    await nextTick(); // the pane reads its `cwd` prop when reloading, so let the new one land
    filesPane.value?.reload();
  },
  { immediate: true },
);

// The pane's SECOND entrance (#910): a file path clicked in terminal output, offered here
// before it falls back to a new tab or the full-screen view. Whether this grid can show it is
// `paneCanShowClick`; all that is left here is doing it.
function openClickedPath(cwd: string, pathRel: string): boolean {
  const state = { zoomed: zoomed.value, expandedCwd: expandedCwd.value, paneCwd: paneCwd.value };
  if (!paneCanShowClick(state, cwd)) return false;
  void showClickedPath(pathRel);
  return true;
}

async function showClickedPath(pathRel: string): Promise<void> {
  if (!filesOpen.value) setFilesOpen(true);
  // Let the pane mount and the re-root watcher put paneCwd under it — the pane resolves the
  // path against that prop, so opening any earlier would read it from the wrong directory.
  await nextTick();
  await filesPane.value?.openFile(pathRel);
}

onMounted(() => setFilesPaneOpener(openClickedPath));
// A stale opener would point at a pane that no longer exists and report success for a click
// nothing acted on — the path would then simply not open anywhere.
onBeforeUnmount(() => setFilesPaneOpener(null));

// Reloading is the case #958 is about, and nothing else snapshots on the way out: the state is
// otherwise written only when the pane closes or re-roots, so a reload would restore whatever
// the user last walked away from rather than what is on screen. `pagehide` rather than
// `beforeunload` — it also fires when the tab is put in the back/forward cache.
const snapshotOnLeave = (): void => rememberPaneState(paneUid.value);
onMounted(() => window.addEventListener("pagehide", snapshotOnLeave));
onBeforeUnmount(() => window.removeEventListener("pagehide", snapshotOnLeave));

// `available` is passed only by the roster splitter, which knows the row's NEW width before the
// browser has laid it out — reading the DOM mid-drag measures the row as it was a frame ago, and
// the pane then keeps a width the row no longer has.
function setPaneWidth(width: number, available = rowWidth()): void {
  rowWidthNow.value = available;
  // Before the row is laid out there is nothing to clamp against, and clamping against zero
  // would "correct" the width to a negative one.
  if (available <= 0) return;
  paneWidth.value = clampPaneWidth(width, available);
}
/** One splitter drag: follow the pointer until it is released, then remember where it landed.
 *  Shared by all three separators beside an enlarged cell (#1077).
 *
 *  `resize` — the pointer's travel along the axis turned into a new size — is the caller's,
 *  because the SIGN is the only thing that differs between them and it is the part worth
 *  reading at the call site: a side before its separator grows as the pointer advances, a side
 *  after it shrinks. */
function dragSplitter(spec: {
  axis: (e: PointerEvent) => number;
  size: () => number;
  resize: (start: number, travel: number) => void;
  key: string;
}): (e: PointerEvent) => void {
  return (e) => {
    const origin = spec.axis(e);
    const start = spec.size();
    const onMove = (ev: PointerEvent) => spec.resize(start, spec.axis(ev) - origin);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      remember(spec.key, String(spec.size()));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
}

// Dragging LEFT grows the file pane: it lies AFTER its separator.
const onSplitterDown = dragSplitter({
  axis: (e) => e.clientX,
  size: () => paneWidth.value,
  resize: (start, travel) => setPaneWidth(start - travel),
  key: PANE_WIDTH_KEY,
});
// The keys act on the TERMINAL's width (ArrowLeft shrinks it, growing the pane), which is what
// splitterKeyWidth speaks — the pane's width is the remainder. Returning null means the key
// isn't ours, and the separator must not swallow Tab or Escape.
function onSplitterKey(e: KeyboardEvent): void {
  const available = rowWidth();
  const next = splitterKeyWidth(e.key, available - paneWidth.value, available);
  if (next === null) return;
  e.preventDefault();
  setPaneWidth(available - next);
  remember(PANE_WIDTH_KEY, String(paneWidth.value));
}
// A window that shrank below the two floors would otherwise leave the pane wider than the row.
const reclampPane = () => filesOpen.value && setPaneWidth(paneWidth.value);
onMounted(() => window.addEventListener("resize", reclampPane));
onBeforeUnmount(() => window.removeEventListener("resize", reclampPane));

// A width restored from storage was clamped against WHATEVER row existed when it was stored —
// a wider window, or the other zoom mode. Re-clamp once the row is actually on screen, or a
// remembered 900px opens against a 1000px row and leaves the terminal 100px wide.
watch([filesOpen, zoomed, () => props.listMode], async ([open, isZoomed]) => {
  if (!open || !isZoomed) return;
  await nextTick();
  setPaneWidth(paneWidth.value);
});

const stage = ref<HTMLElement | null>(null);

// The other two splitters beside an enlarged cell: the roster's width in list mode, and the
// thumbnail strip's height in strip mode (#1077). Both divide the STAGE — the file pane divides
// the row inside it — so they are measured from `stage` rather than `zoomRow`.
//
// The roster sits BEFORE its terminal and the strip AFTER, which is the whole reason
// splitterKeySize is told which side the terminal is on: an arrow key that moved the separator
// the opposite way from the pointer would be worse than no keyboard support.
const ROSTER_WIDTH_KEY = "roster_width";
const STRIP_HEIGHT_KEY = "strip_height";
const ROSTER_WIDTH_DEFAULT = 360;
const STRIP_HEIGHT_DEFAULT = 150;
const rosterWidth = ref(Number(stored(ROSTER_WIDTH_KEY)) || ROSTER_WIDTH_DEFAULT);
const stripHeight = ref(Number(stored(STRIP_HEIGHT_KEY)) || STRIP_HEIGHT_DEFAULT);
// Each stage splitter divides what is left after its own separator (see SEPARATOR_PX).
const stageWidth = () => Math.max(0, (stage.value?.clientWidth ?? 0) - SEPARATOR_PX);
const stageHeight = () => Math.max(0, (stage.value?.clientHeight ?? 0) - SEPARATOR_PX);

// What has to survive to the RIGHT of the roster. The file pane is allowed to be squeezed to
// nothing — it is the yielding side of its own splitter and reopens at whatever width is left —
// but its separator is real estate that exists whenever it is open, so the terminal's floor has
// to be stated on top of it. Without this the roster happily takes the pane's separator too and
// the terminal lands a few pixels under its minimum.
const rosterFloors = computed(() => ({ primary: MIN_TERMINAL + (rightPane.value ? PANE_CHROME_PX : 0), secondary: MIN_ROSTER }));
// Mirrored into refs for the same reason paneMax is: a plain call would not re-render the
// separator's announced range when the stage resizes.
const stageWidthNow = ref(0);
const stageHeightNow = ref(0);
const rosterMax = computed(() => Math.max(0, stageWidthNow.value - rosterFloors.value.primary));
const rosterMin = computed(() => Math.min(MIN_ROSTER, rosterMax.value));
const stripMax = computed(() => Math.max(0, stageHeightNow.value - MIN_TERMINAL_HEIGHT));
const stripMin = computed(() => Math.min(MIN_STRIP, stripMax.value));

function setRosterWidth(width: number): void {
  const available = stageWidth();
  stageWidthNow.value = available;
  if (available <= 0) return; // nothing to clamp against yet; see setPaneWidth
  rosterWidth.value = clampSecondary(width, available, rosterFloors.value);
  // The row the terminal shares with the file pane is what the roster just took from, so the
  // pane is re-clamped against the width the row is ABOUT to have. Computed rather than measured
  // for the reason setPaneWidth's parameter exists.
  if (rightPane.value) setPaneWidth(paneWidth.value, available - rosterWidth.value - PANE_CHROME_PX);
}

function setStripHeight(height: number): void {
  const available = stageHeight();
  stageHeightNow.value = available;
  if (available <= 0) return;
  stripHeight.value = clampSecondary(height, available, TERMINAL_STRIP);
}

// Dragging RIGHT grows the roster: it lies BEFORE its separator.
const onRosterSplitterDown = dragSplitter({
  axis: (e) => e.clientX,
  size: () => rosterWidth.value,
  resize: (start, travel) => setRosterWidth(start + travel),
  key: ROSTER_WIDTH_KEY,
});

// Dragging DOWN shrinks the strip: it lies AFTER its separator.
const onStripSplitterDown = dragSplitter({
  axis: (e) => e.clientY,
  size: () => stripHeight.value,
  resize: (start, travel) => setStripHeight(start - travel),
  key: STRIP_HEIGHT_KEY,
});

// The keys speak the TERMINAL's size (the primary), like the file pane's; each stored size is
// the remainder.
function onRosterSplitterKey(e: KeyboardEvent): void {
  const available = stageWidth();
  const next = splitterKeySize(e.key, available - rosterWidth.value, available, rosterFloors.value, "horizontal", "after");
  if (next === null) return;
  e.preventDefault();
  setRosterWidth(available - next);
  remember(ROSTER_WIDTH_KEY, String(rosterWidth.value));
}

function onStripSplitterKey(e: KeyboardEvent): void {
  const available = stageHeight();
  const next = splitterKeySize(e.key, available - stripHeight.value, available, TERMINAL_STRIP, "vertical", "before");
  if (next === null) return;
  e.preventDefault();
  setStripHeight(available - next);
  remember(STRIP_HEIGHT_KEY, String(stripHeight.value));
}

// Same reason the pane re-clamps: a size restored from storage was clamped against whatever
// stage existed when it was stored, and a window can have shrunk since.
//
// Opening a right-hand pane moves the roster's floor too (PANE_CHROME_PX), which is why
// `rightPane` is watched below: a roster already sitting at its old maximum would otherwise stay
// there and leave the terminal a few pixels under its minimum until something else nudged it.
const reclampStage = () => {
  if (!zoomed.value) return;
  if (props.listMode) setRosterWidth(rosterWidth.value);
  else setStripHeight(stripHeight.value);
};
onMounted(() => window.addEventListener("resize", reclampStage));
onBeforeUnmount(() => window.removeEventListener("resize", reclampStage));
watch([zoomed, () => props.listMode, rightPane], async () => {
  await nextTick();
  reclampStage();
});

// The cells currently flying between slots. Also gates the stylesheet: the cells not in
// flight fade in under them, and the stage stops taking clicks until the batch lands.
const flippingUids = ref<Set<number>>(new Set());
// One expand/collapse is one batch. A newer batch cancels every animation the last one
// still had running, so a fast double-click never leaves a cell stranded mid-transform.
let running: Animation[] = [];

const cellEl = (uid: number) => stage.value?.querySelector<HTMLElement>(`[data-uid="${uid}"]`) ?? null;

// Measure every currently-rendered cell's slot, dropping any the layout has parked
// off-screen. Taken once before the patch and once after; flipPairs keeps only the cells
// on-screen in BOTH, so a cell hidden in one layout (cockpit list mode parks the grid at
// left:-99999px) fades rather than flying across the viewport. Each survivor flies from
// its own old slot.
function measureCells(uids: number[]): Map<number, DOMRect> {
  const rects = new Map<number, DOMRect>();
  for (const uid of uids) {
    const el = cellEl(uid);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (onScreen(rect, window.innerWidth, window.innerHeight)) rects.set(uid, rect);
  }
  return rects;
}

function flipCells(before: Map<number, DOMRect>) {
  // Cancel the previous batch FIRST: a transform still on a cell would move its box, so
  // the `after` measurement below has to read resting layout, not a mid-flight rect.
  running.forEach((a) => a.cancel());
  running = [];
  flippingUids.value = new Set();

  const after = measureCells([...before.keys()]);
  const animations = flipPairs(before, after)
    .map(({ uid, first, last }) => {
      const el = cellEl(uid);
      const frames = el && flipKeyframes(first, last);
      return el && frames ? { uid, anim: el.animate(frames, { duration: FLIP_MS, easing: FLIP_EASING }) } : null;
    })
    .filter((x): x is { uid: number; anim: Animation } => x !== null);
  if (!animations.length) return;

  const batch = animations.map((a) => a.anim);
  running = batch;
  flippingUids.value = new Set(animations.map((a) => a.uid));
  const settle = () => {
    if (running !== batch) return; // a newer batch took over — it owns the class now
    running = [];
    flippingUids.value = new Set();
  };
  // The batch shares one duration + easing, so the last to finish settles them all.
  Promise.allSettled(batch.map((a) => a.finished)).then(settle);
}

// Pre-flush, so the cells are still in the slots they are leaving when we measure them.
// EVERY rendered cell is measured, not just the one being zoomed, so the filmstrip cells
// slide into place alongside it instead of snapping.
watch(
  () => props.expandedUid,
  (to, from) => {
    if (!shouldFlipZoom(to, from, window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const before = measureCells(props.cells.map((c) => c.uid));
    nextTick(() => flipCells(before));
  },
);

// Keep the roster scrolled to whichever terminal is enlarged. Without this, moving the zoom
// from the keyboard highlights a row that is off-screen in a list of every session, so the
// one list meant to say "here is where you are" says nothing.
const rosterRoot = useTemplateRef<HTMLElement>("roster");
watch(
  () => props.expandedUid,
  (uid) => {
    if (uid === null) return;
    nextTick(() => {
      const row = rosterRoot.value?.querySelector(`[data-uid="${uid}"]`);
      // `nearest` so a row already in view is left alone — re-centring on every step would
      // make the list jump under a user who can already see what they picked.
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  },
);
</script>

<template>
  <div ref="stage" class="stage" :class="{ zoomed, listmode: listMode, flipping: flippingUids.size > 0 }" :style="flipVars" @focusin="onFocusIn">
    <!-- Cockpit roster: a tall text row per cell (status / dir / memo / summary / prompt / latest
         reply). Click a row to swap which terminal is enlarged. -->
    <aside
      v-if="zoomed && listMode"
      ref="roster"
      data-testid="cockpit"
      class="flex min-w-0 shrink-0 grow-0 flex-col gap-[5px] overflow-y-auto bg-deep p-1.5"
      :style="{ flexBasis: `${rosterWidth}px` }"
    >
      <div
        v-for="row in listRows"
        :key="row.uid"
        :data-uid="row.uid"
        role="button"
        :tabindex="0"
        data-testid="cockpit-row"
        class="flex shrink-0 cursor-pointer flex-col gap-1 overflow-hidden rounded-lg border border-l-[3px] px-2.5 py-2 text-left text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4a9eff]"
        :class="rosterAlertClass(row.status, { expanded: row.uid === expandedUid, blink: rosterBlink, parked: row.parked })"
        @click="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
        @keydown.enter.self.prevent="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
        @keydown.space.self.prevent="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
      >
        <!-- The status + directory line is the row's header: a bar tinted with the directory's
             configured header colour, pulled to the row's top and side edges. Shared with the
             strip thumbnails (CockpitHeader) so both read as the same directory. -->
        <CockpitHeader
          class="-mx-2.5 -mt-2"
          :status="row.status"
          :agent="row.agent"
          :cwd="row.cwd"
          :home="home"
          :header-color="row.headerColor"
          :header-text-color="row.headerTextColor"
          :work-phase="row.workPhase"
          :phase="row.phase"
        >
          <CockpitRowMenu
            v-if="reorderable"
            :can-up="canMoveCell(cells, row.uid, -1)"
            :can-down="canMoveCell(cells, row.uid, 1)"
            @move="(dir) => emit('move', row.uid, dir)"
          />
        </CockpitHeader>
        <!-- The user's own note, above every line below it: those are what the AGENT said, and the
             memo is the user saying what the cell is FOR (#1084) — the same precedence the cell
             header, the sidebar row and the phone's roster already share via sessionDisplayName.
             Unclamped, alone among these lines, because it needs no guard: normalizeMemo caps a
             memo at one line of 200 code points, where the three below are agent text of no
             bounded length, which is what `cockpitLines` exists for. -->
        <span v-if="row.memo" data-testid="cockpit-memo" class="text-[12px] leading-[1.35]"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">memo</b> {{ row.memo }}</span
        >
        <!-- The clamp is a runtime value, so the utility reads a CSS variable each line sets for
             itself — `line-clamp-N` only exists for the literals Tailwind found in the source.
             `title` carries the rest, so a low clamp hides nothing you can't get at. -->
        <span
          v-if="row.summary"
          data-testid="cockpit-line"
          class="line-clamp-[var(--cockpit-lines)] overflow-hidden text-[12px] leading-[1.35]"
          :style="{ '--cockpit-lines': cockpitLines.summary }"
          :title="row.summary"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">summary</b> {{ row.summary }}</span
        >
        <span
          data-testid="cockpit-line"
          class="line-clamp-[var(--cockpit-lines)] overflow-hidden text-[12px] leading-[1.35]"
          :style="{ '--cockpit-lines': cockpitLines.prompt }"
          :title="row.prompt || row.fallback || undefined"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">prompt</b> {{ row.prompt || row.fallback || "—" }}</span
        >
        <span
          v-if="row.response"
          data-testid="cockpit-line"
          class="line-clamp-[var(--cockpit-lines)] overflow-hidden text-[12px] leading-[1.35] text-dim"
          :style="{ '--cockpit-lines': cockpitLines.response }"
          :title="row.response"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">reply</b> {{ row.response }}</span
        >
      </div>
    </aside>
    <!-- Roster | enlarged cell. Same separator as the file pane's, mirrored: the roster is BEFORE
         it, so the pointer and the arrow keys both move it the other way (#1077). -->
    <div
      v-if="zoomed && listMode"
      data-testid="roster-splitter"
      class="w-[5px] flex-none cursor-col-resize bg-border hover:bg-accent focus-visible:bg-accent"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the roster"
      :aria-valuenow="rosterWidth"
      :aria-valuemin="rosterMin"
      :aria-valuemax="rosterMax"
      title="Drag (or use arrow keys) to resize the roster"
      tabindex="0"
      @pointerdown.prevent="onRosterSplitterDown"
      @keydown="onRosterSplitterKey"
    />
    <!-- The enlarged cell and its file pane, side by side. A row wrapper rather than two more
         siblings of the stage: the stage is a ROW in list mode (roster | terminal) and a COLUMN
         in strip mode (terminal / filmstrip), so only nesting puts the pane beside the terminal
         in both. Hidden outright when nothing is zoomed, like .zoom-main itself. -->
    <div ref="zoomRow" :class="zoomed ? 'flex min-h-0 min-w-0 flex-auto' : 'hidden'">
      <div ref="zoomMain" class="zoom-main" />
      <template v-if="rightPane">
        <div
          class="w-[5px] flex-none cursor-col-resize bg-border hover:bg-accent focus-visible:bg-accent"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side pane"
          :aria-valuenow="paneWidth"
          :aria-valuemin="paneMin"
          :aria-valuemax="paneMax"
          title="Drag (or use arrow keys) to resize the side pane"
          tabindex="0"
          @pointerdown.prevent="onSplitterDown"
          @keydown="onSplitterKey"
        />
        <FilesPane
          v-if="rightPane === 'files'"
          ref="filesPane"
          :cwd="paneCwd"
          :initial-state="paneState"
          :style="{ flex: `0 0 ${paneWidth}px` }"
          class="border-l border-border bg-deep"
          @close="setFilesOpen(false)"
        >
          <!-- Which directory the tree is actually rooted at. It normally follows the enlarged
               cell, but declining a re-root leaves it behind — and then this is the only thing
               that says so. -->
          <template #title>
            <span class="truncate font-mono text-[11px] text-muted" :title="paneCwd ?? ''">{{ formatCwd(paneCwd, home) }}</span>
          </template>
        </FilesPane>
        <!-- Canvas and Tools follow the enlarged cell's SESSION, not its directory, and neither
             holds an unsaved buffer — so unlike the files pane they re-root unconditionally and
             need none of its decline-a-re-root machinery. -->
        <GuiPanel
          v-else-if="rightPane === 'canvas'"
          :session-id="expandedSessionId"
          :send-text-message="sendToExpandedCell"
          :unavailable="canvasUnavailable"
          :style="{ flex: `0 0 ${paneWidth}px` }"
          @toggle-tools="toggleRightPane('tools')"
        />
        <ToolsPane
          v-else-if="rightPane === 'tools'"
          :session-id="expandedSessionId"
          :style="{ flex: `0 0 ${paneWidth}px` }"
          class="border-l border-border"
          @close="setRightPane(null)"
        />
      </template>
    </div>
    <!-- Enlarged cell / thumbnail strip. The stage is a COLUMN in strip mode, so this separator
         is the horizontal one — dragged up and down, and driven by Up/Down rather than Left/Right. -->
    <div
      v-if="zoomed && !listMode"
      data-testid="strip-splitter"
      class="h-[5px] flex-none cursor-row-resize bg-border hover:bg-accent focus-visible:bg-accent"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the thumbnail strip"
      :aria-valuenow="stripHeight"
      :aria-valuemin="stripMin"
      :aria-valuemax="stripMax"
      title="Drag (or use arrow keys) to resize the thumbnail strip"
      tabindex="0"
      @pointerdown.prevent="onStripSplitterDown"
      @keydown="onStripSplitterKey"
    />
    <!-- In strip mode the grid IS the thumbnail strip, and its height is the user's (#1077). The
         stylesheet's `flex: 0 0 150px` stays as the default; an inline basis outranks it, and is
         bound only in that mode so it cannot reach the tiled grid or list mode's off-screen one. -->
    <div class="grid" :style="[gridStyle, zoomed && !listMode ? { flexBasis: `${stripHeight}px` } : {}]">
      <Teleport v-for="cell in cells" :key="cell.uid" :to="zoomMain" :disabled="!(zoomed && cell.uid === expandedUid)">
        <CommandCell v-if="cell.command" v-bind="gridCellProps(cell)" :command="cell.command" v-on="gridCellEvents(cell)" />
        <LauncherCell
          v-else-if="cell.launcher"
          :uid="cell.uid"
          v-bind="gridCellProps(cell)"
          :launcher="cell.launcher"
          :session="cell.session"
          :cwd="cell.cwd"
          v-on="gridCellEvents(cell)"
          @session="(id) => emit('session', cell.uid, id)"
        />
        <TerminalCell
          v-else
          :uid="cell.uid"
          v-bind="gridCellProps(cell)"
          :initial-session-id="cell.session"
          :initial-cwd="cell.cwd"
          :initial-agent="cell.agent"
          :default-cwd="defaultCwd"
          :presets="presets"
          :launchers="launchers"
          :open-session-ids="openSessionIds"
          :open-cwds="openCwds"
          :cancellable="cell.uid === cancelUid"
          :parked="cell.parked === true"
          v-on="gridCellEvents(cell)"
          @park="(on) => emit('park', cell.uid, on)"
          @session="(id) => emit('session', cell.uid, id)"
          @agent="(a) => emit('agent', cell.uid, a)"
          @cwd="(c) => emit('cwd', cell.uid, c)"
          @record-cwd="(c) => emit('record-cwd', c)"
          @remove-preset="(path) => emit('remove-preset', path)"
          @run="(cmd) => emit('run', cell.uid, cmd)"
          @run-spare="(cmd) => emit('runSpare', cell.uid, cmd)"
          @launch="(pick) => emit('launch', cell.uid, pick)"
        />
      </Teleport>
    </div>
  </div>
</template>

<!-- The one <style> block left in the app, and a deliberate exception to CLAUDE.md's
     "utilities only" rule. Both escapes the rule offers were measured and rejected:

     * The THEME route does not work here. `cell-in` / `strip-in` are referenced from the
       descendant selectors below, not from an `animate-*` utility on an element — and Tailwind
       drops an `@theme` keyframes block that no utility mentions (verified: an unused one emits
       nothing at all). Moving them there would silently stop the FLIP cross-fade, with no error
       and no failing test.
     * The GLOBAL-STYLESHEET route needs renames to be safe. `.grid` and `.stage` are generic
       enough that `.grid` already exists in three other components, so lifting these out of
       scope invites collisions.

     What is actually being expressed is the grid's layout state machine — three modes (tiled /
     zoomed+roster / zoomed+strip) applied to `.grid > *`, which are the Teleport-ed cell
     components. This component does not own their markup, so making these utilities would mean
     handing grid-layout state to CommandCell, LauncherCell and TerminalCell individually.

     The off-screen box in list mode (`left: -99999px` at a real 900x600) is load-bearing, not
     cosmetic: it keeps the non-expanded cells mounted with a measurable size so xterm never fits
     itself to zero. See #1125. -->
<style scoped>
.stage {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-deep);
}

.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  padding: 6px;
  box-sizing: border-box;
}

/* The focused cell grows via `transform: scale` (see `.focused`). That growth is a fraction
   of the cell's size, which for a wide/tall edge cell can push its edge past the viewport's
   `overflow:hidden` and clip the outermost characters. Inset the tiled grid by an amount that
   tracks the cell size on each axis — % of width horizontally, vh vertically — so the reserved
   room matches the scale at any window size and the zoom always stays on screen. (Scoped to the
   non-zoomed grid so the zoomed filmstrip keeps its own padding.) */
.stage:not(.zoomed) .grid {
  padding: calc(6px + 1.5vh) calc(6px + 1.6%);
}

/* Inert until a cell is zoomed. */
.zoom-main {
  display: none;
}

.zoom-main > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.stage.zoomed .zoom-main {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/* List mode: text roster on the left, the expanded terminal on the right. */
.stage.zoomed.listmode {
  flex-direction: row;
}

.stage.zoomed.listmode .zoom-main {
  padding: 6px 6px 6px 0;
}

/* Keep the non-expanded cells mounted (connections + metadata stay live) but OFF the visible
   layout. A real off-screen box means xterm never fits to zero. */
.stage.zoomed.listmode .grid {
  position: absolute;
  left: -99999px;
  top: 0;
  width: 900px;
  height: 600px;
  display: block;
  overflow: hidden;
  padding: 0;
}

.stage.zoomed.listmode .grid > * {
  width: 900px;
  height: 600px;
}

/* Strip mode (toggle): the original filmstrip — expanded terminal on top, thumbnails below. */
.stage.zoomed:not(.listmode) {
  flex-direction: column;
}

.stage.zoomed:not(.listmode) .zoom-main {
  padding: 6px 6px 0;
}

.stage.zoomed:not(.listmode) .grid {
  flex: 0 0 150px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
}

.stage.zoomed:not(.listmode) .grid > * {
  flex: 0 0 260px;
  height: 100%;
  min-width: 0;
}

/* The keyboard-focused cell lifts and grows slightly, in place — tiled grid only, so it never
   applies to a filmstrip thumbnail (.stage.zoomed) or a cell mid-FLIP. The transform doesn't change
   the cell's layout size, so xterm isn't refit and the PTY isn't resized.
   What grows is the FRAME: the cell's content (CELL_INNER) cancels this scale out about the same
   centre, because the terminal is a canvas and scaling a canvas resamples it (#965). The factor is
   a token for that reason — a literal here would silently stop matching the inverse. */
.stage:not(.zoomed) .grid > *:not(.flipping) {
  transition:
    transform 140ms ease,
    box-shadow 140ms ease;
}

.stage:not(.zoomed) .grid > .focused {
  transform: scale(var(--focus-zoom));
  z-index: 5;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}

@media (prefers-reduced-motion: reduce) {
  .stage:not(.zoomed) .grid > *:not(.flipping) {
    transition: none;
  }
}

/* A second click landing mid-flight would measure a transformed cell and flip from the
   wrong rect, so the stage stays inert until the cell lands. */
.stage.flipping {
  pointer-events: none;
}

/* Restoring shrinks the cell from the overlay's rect back into its grid slot, so it
   starts out overflowing its siblings — it has to paint above them the whole way. */
.stage.flipping .flipping {
  z-index: 1;
}

/* Cells present in both layouts fly (they carry `.flipping`); the ones left here are the
   other tabs' cells, which appear in (or vanish from) the filmstrip with no counterpart to
   fly from, so they cross-fade instead. */
.stage.flipping .grid > *:not(.flipping) {
  animation: cell-in var(--flip-ms) var(--flip-ease);
}

.stage.flipping.zoomed .grid > *:not(.flipping) {
  animation-name: strip-in;
}

@keyframes cell-in {
  from {
    opacity: 0;
  }
}

@keyframes strip-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
