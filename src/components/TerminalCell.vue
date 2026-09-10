<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted, useTemplateRef } from "vue";
import TerminalView from "./Terminal.vue";
import { usePubSub } from "../composables/usePubSub";
import { useImeAwareEnter } from "../composables/useImeAwareEnter";
import { useBusyAction } from "../composables/useBusyAction";
import { useCellChrome } from "../composables/useCellChrome";
import { useGitStatus } from "../composables/useGitStatus";
import { useWorkItem } from "../composables/useWorkItem";
import { dismissWorkCommentFailure, visibleWorkCommentFailure } from "../composables/workCommentNotice";
import { formatCwd } from "./cwdDisplay";
import { worktreeLabel } from "../../common/worktreePath";
import { isSameDirPath } from "../../common/dirPathKey";
import DirBadge from "./DirBadge.vue";
import DirIcon from "./DirIcon.vue";
import CollectionMark from "./CollectionMark.vue";
import { isCellContext, isCellUsage, type CellContext, type CellUsage } from "./cellPayload";
import { asTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { customAgentIdOf, customAgentPick, isCustomAgentId, type AgentPick, type CustomAgent } from "../../common/customAgents";
import { unsavedWork } from "./unsavedWork";
import { shouldPromptTidy } from "./mergedTidy";
import { usageBadge } from "./cellDisplay";
import { applyActivityPush, cellHeaderText, type ActivityPush } from "./cellActivity";
import { MEMO_MAX_LENGTH, normalizeMemo } from "../../common/sessionMemo";
import { asSessionCollection, type SessionCollection } from "../../common/sessionCollection";
import { preferredLaunchDir, shouldSyncLaunchDir } from "./launchDir";
import CellLaunchForm from "./CellLaunchForm.vue";
import GitBranchChip from "./GitBranchChip.vue";
import WorkItemChip from "./WorkItemChip.vue";
import WorktreeEnvChip from "./WorktreeEnvChip.vue";
import CellTidyPrompt from "./CellTidyPrompt.vue";
import WorkCommentNotice from "./WorkCommentNotice.vue";
import ModelContextBadge from "./ModelContextBadge.vue";
import type { LaunchChoice } from "./wsUrl";
import type { RunCommand } from "./runCommand";
import { useHeaderButtons } from "../composables/useHeaderButtons";
import { openTerminalAt } from "../composables/useNewTerminal";
import { registerCellRestart } from "../composables/useCellRestart";
import { reapSessionOnServer, restartSession } from "../composables/restartSession";
import TimelineOverlay from "./TimelineOverlay.vue";
import CopyCodeBlock from "./CopyCodeBlock.vue";
import CockpitHeader from "./CockpitHeader.vue";
import CellChromeButtons from "./CellChromeButtons.vue";
import { isCellSunk, SUNK_CELL, SUNK_DOT_STATUS } from "./cellParked";
import { cellChromeBinding } from "./cellChromeBinding";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";
import { shellLauncher } from "./gridTabs";
import { activityStatus, type AttentionStatus } from "./attentionStatus";
import { useMissedAttention } from "../composables/useMissedAttention";
import type { AgentReport, GridCellEmits, GridCellProps } from "./gridCell";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";
import {
  CELL_ACTIONS,
  CELL_BTN,
  CELL_CHIP_BTN,
  CELL_CHIP_ICON,
  CELL_DIR_PATH,
  CELL_HEADER_INK_DIM,
  CELL_MENU_ITEM,
  CELL_DOT,
  CELL_HEADER_ZOOMABLE,
  CELL_INNER,
  CELL_TERM,
  DIR_TRUNCATE_FRONT,
} from "./cellChromeClasses";
import { CELL_STATUS, DOT_STATUS, HEADER_STATUS } from "./cellStatusClasses";
import { headerStatusStyleFor } from "./cellHeaderStyle";
import { mergeHeaderStatusColors } from "../../common/headerStatusColors";
import { globalHeaderStatusColors, globalHeaderStatusTint } from "../composables/headerStatusColors";
import { handoffTargets, pullLastTurn, slotLabel, type HandoffTarget } from "../composables/useHandoff";
import { menuPlacement } from "../composables/menuPlacement";
import { runOneExchange, liveCrossTalkDeps } from "../composables/useCrossTalk";
import { runRoundTable, liveRoundTableDeps, memberFromTarget, type TableMember } from "../composables/useRoundTable";
import { roundTableMessage } from "../composables/roundTableRules";
import RoundTableMenu from "./RoundTableMenu.vue";
import { outcomeMessage } from "../composables/exchangeRules";
import { worktreeFailureMessage, worktreeRequestFailure } from "./cellChromeRules";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

// How long a handoff failure stays on the cell before it clears itself.
const ASK_MSG_MS = 4000;

const termRef = useTemplateRef<InstanceType<typeof TerminalView>>("termRef");

// Clicking the header background zooms this cell (mirrors clicking the terminal body) —
// in the tiled grid and as a filmstrip thumbnail alike. Only the already-expanded cell
// stays inert (restore via the restore button). Header buttons keep their action.
function onHeaderClick(event: MouseEvent) {
  if (shouldZoomOnHeaderClick(event.target, props.expanded, props.hideExpand)) emit("toggle-expand");
}

// `expanded` reflects whether this cell is zoomed to fill the grid (parent owns
// the state). `initialSessionId` resumes a session on mount (reload restore).
// `initialCwd` is this cell's persisted working dir; `defaultCwd` is the server
// default used to prefill the launch form; `presets` are quick-pick dirs; `home`
// is the server home dir (to anchor the header path on ~).
const props = defineProps<
  GridCellProps & {
    // The grid cell's stable uid — the durable-connection slot key for this cell's
    // terminal, so flipping to an off-page tab detaches the view without reaping the PTY.
    uid: number;
    initialSessionId: string | null;
    initialCwd: string | null;
    // The persisted agent for this cell; absent (or "claude") resumes as a normal Claude session.
    initialAgent?: TerminalAgent | null | undefined;
    // The custom-agent entry this cell was launched from (#1414), when the pick came from OUTSIDE
    // the cell — the launch panel creates the cell already knowing which wrapper to run. Seeds the
    // Agent Picker below; `initialAgent` still says which CLI's arguments the wrapper is handed.
    initialCustomAgent?: string | null | undefined;
    // The provider/model the launch form picked, when the pick came from OUTSIDE the cell (the
    // launch panel, #1867). Seeds `launchChoice` below, which is what the connection reads.
    initialLaunchChoice?: LaunchChoice | null | undefined;
    // Start `initialAgent` in `initialCwd` on mount rather than opening the launcher form. Set by
    // the grid for a cell it already knows what to run — the phone's launch request (#831).
    autoStart?: boolean;
    defaultCwd: string | null;
    presets: CwdPreset[];
    // The saved directories could not be read at all — passed straight to the launch form, which
    // says so where the chips would be.
    configUnavailable?: boolean;
    // Configured launch commands (shell/codex/…) offered next to Claude in this launcher.
    launchers?: Launcher[];
    // The user's own ways of starting Claude Code, offered in this cell's Agent Picker (#1414).
    customAgents?: CustomAgent[];
    // Session ids open in other grid cells. Resuming one of them would detach that
    // cell, so the launcher flags such rows and confirms before opening.
    openSessionIds?: string[];
    // Dirs with a running session in another cell, so the launcher can tint preset
    // chips whose dir is already in use.
    openCwds?: string[];
    // Manual sort mode: show move buttons to swap this cell with its neighbour.
    reorderable?: boolean;
    // Set aside by the user (#992): sunk out of the way, still connected, still holding history.
    parked?: boolean;
  }
>();
const emit = defineEmits<
  GridCellEmits & {
    // `record-cwd`: auto-record a fresh launch's server-confirmed cwd as a preset.
    // `remove-preset`: drop a preset (its close button) from the shared list — value is the path.
    (e: "session" | "cwd" | "record-cwd" | "remove-preset", value: string): void;
    // `run` launches in THIS (empty) cell from the launcher; `runSpare` is the running
    // terminal's header menu, which must NOT replace the session — it runs in a new cell.
    (e: "run" | "runSpare", value: RunCommand): void;
    // The user picked a configured launcher (shell/codex/…) to run in this empty cell.
    (e: "launch", value: LaunchPick): void;
    // The agent chosen for this fresh launch, so the grid persists it.
    (e: "agent", value: AgentReport): void;
    // Set this cell aside, or bring it back. The grid owns the flag; this only asks.
    (e: "park", value: boolean): void;
    // The launch form's "try again" on a config that could not be read. Value-less: the shell owns
    // the read, this only asks for another one.
    //
    // `canvas`: the Mulmo menu put a deck on this cell's Canvas and it wants showing. The grid owns
    // the right pane; this only forwards the ask (#1948).
    (e: "retry-config" | "canvas"): void;
  }
>();

// `close` rather than a plain forward: this cell's may hold a live session, so it confirms first.
const { chromeProps, chromeEvents } = cellChromeBinding(props, emit, () => void close());

// A cell with a persisted session relaunches (resumes) on mount; otherwise it
// starts empty and lazy-launches when the user picks a dir and clicks Start.
const launched = ref(props.initialSessionId !== null);
const sessionId = ref<string | null>(props.initialSessionId);
// What the launch form's AGENT PICKER will start here. "shell" is one of its options and is a
// LAUNCHER, not an agent: the parent replaces this cell with a launcher cell, so it never becomes
// the `agent` below.
const pickedAgent = ref<AgentPick>(isCustomAgentId(props.initialCustomAgent) ? customAgentPick(props.initialCustomAgent) : asTerminalAgent(props.initialAgent));
// The custom agent this cell was started from, or null for a built-in (#1414). It rides alongside
// `agent`, which stays "claude" for a custom one: a wrapper decides which command line starts
// Claude Code, not what the session IS — see common/customAgents.ts.
const customAgentId = computed<string | null>(() => customAgentIdOf(pickedAgent.value));
// The agent this cell runs (Claude by default). Fixed once launched; restored from the
// persisted cell on reload so a codex / antigravity cell reconnects to its WS endpoint.
// Derived from the picker so ONE pick drives both — two refs holding the same choice is the
// kind of pair that drifts. asTerminalAgent maps "shell" to claude, which nothing reads: a shell
// launch leaves this cell instead of running in it.
const agent = computed<TerminalAgent>(() => asTerminalAgent(pickedAgent.value));
const connectKey = ref(0);

// The directory this terminal runs in (shown in the header, sent to the server).
const cwd = ref<string | null>(props.initialCwd ?? props.defaultCwd);
// Per-directory overrides (<cwd>/.mulmoterminal.json): pins this cell's terminal
// palette and shows a project badge. Re-fetched when the effective cwd changes.
const { config: dirConfig, cellStyle } = useCellChrome(cwd);
// Whether this cell IS the workspace, for the header badge. Same lexical comparison the launcher
// chip makes (`launchChips`), so a cell launched from the WORKSPACE chip is badged WORKSPACE.
const isWorkspace = computed(() => isSameDirPath(cwd.value, props.defaultCwd));
// What this cell is working on (PR + issue), for the `work` chip. Same directory, same kind of
// poll as the git status below.
const { item: workItem, refresh: refreshWorkItem, commentFailure } = useWorkItem(cwd);
// "issueWorkComments is on and the issue is NOT being updated" (#1369). Outside the chip loop for
// the same reason as the tidy prompt below: it reports on a setting, not on the work.
const workCommentNotice = computed(() => visibleWorkCommentFailure(commentFailure.value));
// Live git status (branch/dirty/ahead·behind) for the header chip. `refreshGit`
// is called alongside loadDiff() so a finished turn's changes show immediately.
const { status: gitStatus, refresh: refreshGit } = useGitStatus(cwd);
// Activity timeline overlay (the header history button) — only meaningful for a Claude session.
const timelineOpen = ref(false);
// A small filmstrip thumbnail (some OTHER cell is zoomed): strip the header to just
// dir + what it's doing + a zoom button, and hide the second (terminal) header row.
const filmstrip = computed(() => !!props.zoomed && !props.expanded);
// The launch form's editable dir. Prefer this cell's persisted dir, then the most
// recent preset, then the server default. Both `presets` and `defaultCwd` arrive
// async from /api/config, so the watcher upgrades a still-pristine field once they
// load (cold-load / open-before-config) — it never clobbers the user's own edit.
const dirInput = ref(preferredLaunchDir(props));
const dirTouched = ref(false); // true once the user types in / picks a dir
// Typing, a preset chip and the folder picker all report the dir the same way, so the "the user
// chose this one" flag is set in one place.
function onLaunchDir(dir: string) {
  dirInput.value = dir;
  dirTouched.value = true;
}
watch([() => props.presets, () => props.defaultCwd], () => {
  if (cwd.value === null && props.defaultCwd) cwd.value = props.defaultCwd;
  if (!shouldSyncLaunchDir({ hasInitialCwd: !!props.initialCwd, touched: dirTouched.value, launched: launched.value })) return;
  const preferred = preferredLaunchDir({ presets: props.presets, defaultCwd: props.defaultCwd });
  if (preferred && dirInput.value !== preferred) dirInput.value = preferred;
});

// Live activity for this session, from the "sessions" pub/sub channel.
const working = ref(false);
const waiting = ref(false);
// The hook that set the current state ("Stop" | "Notification" | …). Splits `waiting`
// into done (Stop) vs blocked (Notification) — see activityStatus.
const activityEvent = ref<string | null>(null);
const lastPrompt = ref<string | null>(null);
// A cheap-model summary of the recent turns (issue #316). Preferred over lastPrompt in
// the header because a raw follow-up prompt goes stale ("ok") or context-dependent once
// the session is a back-and-forth. Null until the server generates/pushes one.
const aiTitle = ref<string | null>(null);
// The user's own one-line note on this session (#1084). It outranks both of the above in the
// header: they say what the agent said, this says what the cell is FOR — the question six open
// cells stop answering. Null until the server pushes one.
const memo = ref<string | null>(null);
const memoEditing = ref(false);
const memoDraft = ref("");
// Which collection this chat was opened FROM (#2020), or null for every cell that was not. Read
// from the same /api/session/:id seed as the fields above rather than from the browser's own
// filing, so a reload, a second tab and a phone all show the same mark.
const collection = ref<SessionCollection | null>(null);

// Cumulative token usage for this session (from /api/session/:id, refreshed when a
// turn finishes). Null until first fetched.
const usage = ref<CellUsage | null>(null);

// The running model + current-turn context size (from /api/session/:id), for the
// model/context badge. Null until first fetched; model may be null with no assistant
// turn yet, which hides the badge.
const context = ref<CellContext | null>(null);

// Configurable row-1 info chips (GET /api/header `chips`). `null` = unconfigured ⇒ the default order/set
// below, so with no config the header is exactly as before. When configured, the built-ins listed here
// (git/diff/ctx/usage) render in that order — others are hidden — and custom chips render as text. `dir`,
// the project badge, the status dot/activity, and the row-2 tools timeline stay structural.
const { chips: headerChips, env: worktreeEnv } = useHeaderButtons({ cwd, session: sessionId, agent, model: computed(() => context.value?.model ?? null) });
const ROW1_BUILTIN_CHIPS = new Set(["git", "work", "diff", "ctx", "usage", "env"]);
// `env` is in the defaults and costs nothing to a project that declares no `worktreeEnv`: the
// chip renders nothing when there are no values, so this only shows up where it was asked for.
const DEFAULT_CELL_CHIP_IDS = ["git", "work", "diff", "ctx", "usage", "env"];
interface CellChipView {
  key: string;
  builtin: string | null;
  custom: { label: string; text: string } | null;
}
const cellChips = computed<CellChipView[]>(() => {
  const configured = headerChips.value;
  if (configured === null) return DEFAULT_CELL_CHIP_IDS.map((id) => ({ key: `b-${id}`, builtin: id, custom: null }));
  const views: CellChipView[] = [];
  // Key by index so a config that repeats a built-in (sanitizeChips allows duplicates) can't collide.
  configured.forEach((chip, i) => {
    if (chip.kind === "custom") views.push({ key: `c-${i}`, builtin: null, custom: { label: chip.label, text: chip.text } });
    else if (ROW1_BUILTIN_CHIPS.has(chip.id)) views.push({ key: `b-${i}-${chip.id}`, builtin: chip.id, custom: null });
  });
  return views;
});

const { subscribe, onReconnect } = usePubSub();
let unsubscribe: (() => void) | null = null;
let offReconnect: (() => void) | null = null;

interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
  lastPrompt?: string | null;
  aiTitle?: string | null;
  memo?: string | null;
}
const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

// Bumped on every applied activity change. A seed (loadInitial) reads the state as of the
// moment it ASKED; a live push that lands while it is in flight is newer, so the seed must
// not overwrite it — the #620 race, scoped to one cell.
let activityGen = 0;
// Seeds also overlap each other — mount racing a reconnect, or reconnect flaps. Only the
// newest may apply; an older one, even resolving last, describes a moment already overtaken.
let latestSeed = 0;
// The usage/context badges are filled from two async sources — a seed (loadInitial) and
// refreshUsage on turn end — so back-to-back turns can leave two /api/session reads in
// flight at once. Neither path bumps latestSeed for badges, so a stale read resolving last
// would clobber the newer numbers. This token makes the newest badge fetch win. (#620.)
let latestBadgeReq = 0;
function applyActivity(d: ActivityPush) {
  activityGen++;
  const next = applyActivityPush(
    {
      working: working.value,
      waiting: waiting.value,
      event: activityEvent.value,
      lastPrompt: lastPrompt.value,
      aiTitle: aiTitle.value,
      memo: memo.value,
    },
    d,
  );
  working.value = next.working;
  waiting.value = next.waiting;
  activityEvent.value = next.event;
  lastPrompt.value = next.lastPrompt;
  aiTitle.value = next.aiTitle;
  // Not while the box is open: the push that lands as another tab saves would otherwise
  // overwrite the sentence being typed here, mid-word.
  if (!memoEditing.value) memo.value = next.memo;
}

// A cell whose model is still unknown asks again when a push says something changed. codex and agy
// file their logs under an id the agent mints AFTER the spawn, so the seed fetch at mount can only
// answer "nobody" — and for agy nothing else would ever re-ask, since it has no hooks and no
// activity tracker to finish a turn (its spawner publishes precisely to reach this line). Claude is
// excluded: its badges come from the summary the route already folds, so a push adds nothing and
// this is the busiest route in the app. Self-limiting either way — once a model is known, it stops.
//
// Called from the PUSH path only, never from a seed: loadInitial applies activity BEFORE badges, so
// asking there would see `context` still empty and fire a second fetch for the answer already in
// its hand — on every non-claude cell, every load.
function refreshBadgesIfModelUnknown() {
  if (agent.value !== "claude" && !context.value?.model) void refreshUsage();
}

// This session's detail, or nothing to apply. Nothing covers three cases the callers all
// treat the same: the read failed (best-effort — pub/sub fills it in on the next event), the
// server refused, or the cell has since closed or switched session, in which case applying
// the answer would leak the old session's state into the new one.
//
// The cell's dir goes along so the server can read the transcript and report the session's
// most recent prompt rather than the bare id after a resume. It is read as a plain record: the
// endpoint answers the session's own fields and sends no `id`, so it is not an ActivityMsg.

// Reads the activity fields off an untrusted body while KEEPING the absent/null distinction
// applyActivityPush is built on: a key the server did not send must stay absent ("keep what is
// shown"), which is a different instruction from an explicit null ("there is none now").
function activityPushOf(d: Record<string, unknown>): ActivityPush {
  const push: ActivityPush = {};
  if (typeof d.working === "boolean") push.working = d.working;
  if (typeof d.waiting === "boolean") push.waiting = d.waiting;
  for (const key of ["event", "lastPrompt", "aiTitle", "memo"] as const) {
    const value = d[key];
    if (value === null || typeof value === "string") push[key] = value;
  }
  return push;
}

async function fetchSessionDetail(id: string): Promise<Record<string, unknown> | null> {
  try {
    // The agent goes along because the two header badges are read from ITS log, not Claude's
    // (#1465) — and grok's is partitioned by directory, so the cwd is part of that lookup too.
    const params = new URLSearchParams({ agent: agent.value });
    if (cwd.value) params.set("cwd", cwd.value);
    const res = await fetchWithTimeout(`/api/session/${id}?${params}`);
    if (!res.ok) return null;
    const data = await jsonBody(res);
    return id === sessionId.value ? data : null;
  } catch {
    return null;
  }
}

// Cleared rather than kept when the shape is wrong: the server always sends both
// (EMPTY_USAGE / EMPTY_CONTEXT when it has nothing to report), so an unrenderable one means
// something is actually broken — and a badge showing the previous turn's numbers as if they
// were current is the failure the guards exist to stop.
function applyBadges(data: Record<string, unknown>) {
  usage.value = isCellUsage(data.usage) ? data.usage : null;
  context.value = isCellContext(data.context) ? data.context : null;
}

async function loadInitial(id: string) {
  const seedId = ++latestSeed;
  const badgeReq = ++latestBadgeReq;
  const genBeforeFetch = activityGen;
  const data = await fetchSessionDetail(id);
  // A newer seed superseded this one while it was in flight: its answer is the current one,
  // so this stale snapshot applies neither activity nor badges.
  if (!data || seedId !== latestSeed) return;
  // A live push landed while we were fetching: it is newer than this snapshot, so keep it
  // and don't let a stale seed put the cell back to idle. Badges have no such push, so they
  // always refresh — unless a newer badge fetch has since superseded this one.
  if (activityGen === genBeforeFetch) applyActivity(activityPushOf(data));
  if (badgeReq === latestBadgeReq) applyBadges(data);
  // Not guarded by either token: it is a fact about how the session began, so every answer for
  // this id carries the same one and there is no older-vs-newer to lose.
  collection.value = asSessionCollection(data.collection);
}

// Refresh ONLY the token usage (not the live activity — that's pub/sub's job). Called
// when a turn finishes, so the badge reflects the just-completed turn.
async function refreshUsage() {
  const id = sessionId.value;
  if (!id) return;
  const badgeReq = ++latestBadgeReq;
  const data = await fetchSessionDetail(id);
  if (data && badgeReq === latestBadgeReq) applyBadges(data);
}

// Canvas output this cell has produced that nobody has looked at. The grid is a TRIAGE board,
// so the drawing itself stays in the expanded view — but without a signal here, output on an
// un-expanded cell leaves no trace at all and is only discovered by expanding it. A count, not
// a preview: reading belongs in the pane.
//
// Counted from LIVE arrivals only, with no history replay: "unseen" means "since you last
// looked", and nine cells each fetching a session's stored results to compute a badge would
// cost more than the badge is worth.
//
// Deliberately NOT folded into the attention colours: an unread drawing is not the same as an
// agent blocked on a permission prompt, and letting it raise amber would spend the one signal
// that means "you are needed here".
const unseenCanvas = ref(0);
let unsubscribeCanvas: (() => void) | undefined;

function watchCanvasOutput(id: string | null) {
  unsubscribeCanvas?.();
  unsubscribeCanvas = undefined;
  unseenCanvas.value = 0;
  if (!id) return;
  unsubscribeCanvas = subscribe(`session:${id}`, () => {
    // Already looking at it: arrivals land in a pane the user can see, so nothing is unseen.
    if (props.expanded && props.rightPane === "canvas") return;
    unseenCanvas.value += 1;
  });
}
watch(sessionId, watchCanvasOutput, { immediate: true });
// Opening the pane on this cell clears the count — that IS having looked.
watch(
  () => props.expanded && props.rightPane === "canvas",
  (looking) => {
    if (looking) unseenCanvas.value = 0;
  },
);

// An agy or grok cell has no turn to end. Claude publishes a Stop hook and codex has an activity
// tracker, so both re-read their badges the moment a turn settles; NOTHING calls setWorking for
// these two, so a reading taken when the cell first asked is the only one it ever gets — `ctx 1%`
// for the rest of the session, which is worse than no reading at all. Nor does the push path save
// them: `refreshBadgesIfModelUnknown` needs an activity push, and an agent that never sets a flag
// never sends one. This is the substitute, and it is deliberately slow — per cell, per minute:
// agy pays one indexed sqlite row plus a 64 KB head read, grok two small JSON reads plus a fold
// resumed at the byte the last poll stopped on. Delete each the day its agent gets an activity
// tracker.
const UNTRACKED_BADGE_AGENTS = new Set(["antigravity", "grok", "muse"]);
const UNTRACKED_BADGE_POLL_MS = 60_000;
let badgePoll: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  unsubscribe = subscribe("sessions", (d) => {
    if (!isActivityMsg(d) || d.id !== sessionId.value) return;
    applyActivity(d);
    refreshBadgesIfModelUnknown();
  });
  badgePoll = setInterval(() => {
    if (UNTRACKED_BADGE_AGENTS.has(agent.value) && sessionId.value) void refreshUsage();
  }, UNTRACKED_BADGE_POLL_MS);
  // A dropped socket misses the pushes sent while it was down, and this cell's status is
  // derived state that pub/sub only replays room membership for — not the missed events. So
  // on reconnect re-seed from the authoritative snapshot (guarded by activityGen), or a turn
  // that started during the outage stays showing idle until it ends.
  offReconnect = onReconnect(() => {
    if (sessionId.value) void loadInitial(sessionId.value);
  });
  if (sessionId.value) {
    void loadInitial(sessionId.value);
    void loadDiff(); // a resumed worktree cell shows its diff on restore
  }
});
onUnmounted(() => {
  unsubscribe?.();
  unsubscribeCanvas?.();
  offReconnect?.();
  if (badgePoll) clearInterval(badgePoll);
});

// Set when the user starts a FRESH session from the launcher, so the next server
// cwd report is recorded as a preset — but a reconnect/restore of an existing
// session (which also reports a cwd) is not, or the preset list would be rewritten
// in mount order on reload instead of reflecting what the user actually launched.
let recordNextCwd = false;

// Start a fresh session in `dir`. Optimistic display only; the persisted/displayed
// truth is the EFFECTIVE cwd the server confirms (onServerCwd), which may fall back.
function launchIn(dir: string | null) {
  cwd.value = dir;
  sessionId.value = null; // new session — the server generates the id
  connectKey.value++;
  launched.value = true;
  // BOTH halves. `agent` is "claude" for a custom pick, so reporting it alone reads to the grid as
  // "the user switched off the wrapper" — which is what silently dropped `customAgent` on the very
  // launch that was using it (codex + CodeRabbit, #1890).
  emit("agent", { agent: agent.value, customAgent: customAgentId.value });
  recordNextCwd = true;
  void loadDiff(); // no-op for a non-worktree dir
}
// The provider/model picked in the launch form, for the session this cell is about to
// start. Null — the usual case — means the directory's own default decides. Kept for the
// life of the cell so a relaunch in the same cell repeats the choice.
const launchChoice = ref<LaunchChoice | null>(props.initialLaunchChoice ?? null);

// Start what the Agent Picker picked, in `dir`. EVERY launch in the form goes through here: the
// picker decides for the dir field, for a preset chip, and for a worktree alike, and a rule
// that has to hold at three call sites belongs in one of them.
function startPickedAgent(dir: string | null) {
  if (pickedAgent.value === "shell") emit("launch", { launcher: shellLauncher(), cwd: dir });
  else launchIn(dir);
}

// The cell was opened with its agent and directory already decided (the phone's launch request),
// so start it rather than showing the launcher for someone at the desktop to press Start.
//
// On MOUNT, once — never a watcher on the prop. Closing a session returns this same component to
// the launch form without unmounting it (`teardown`), so a watcher would relaunch under the user.
onMounted(() => {
  if (props.autoStart && !launched.value && props.initialCwd) launchIn(props.initialCwd);
});

// Attach to a session the form listed, in the cwd those rows were fetched for (not the
// possibly-changed input).
//
// `resumeAgent` is what the session IS, which the row knows and the Agent Picker may disagree
// with: connecting a live codex id to /ws because the picker still says Claude runs the wrong
// endpoint against a real session. Both kinds of row send it — a worktree row, whose session may be
// any agent, and a resume row, which since #1417 lists the PICKED agent's own conversations rather
// than always Claude's. Absent (an older caller) leaves the pick alone.
function resumeSession({ id, cwd: dir, agent: resumeAgent }: { id: string; cwd: string | null; agent?: TerminalAgent }) {
  if (resumeAgent) {
    pickedAgent.value = resumeAgent;
    // A resumed session already exists; it was not started through a wrapper now, so the cell is
    // no longer running one whatever it was launched from.
    emit("agent", { agent: resumeAgent, customAgent: null });
  }
  cwd.value = dir;
  sessionId.value = id;
  connectKey.value++;
  launched.value = true;
  recordNextCwd = false; // resuming isn't a fresh launch — don't record its cwd
  void loadDiff(); // an already-idle worktree session shows its badge right away
}

// Reveal this cell's working directory in the OS file manager. The browser can't
// open a folder, but the local server can (POST /api/open-dir).
async function openDir() {
  if (!cwd.value) return;
  try {
    const res = await fetchWithTimeout("/api/open-dir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: cwd.value }),
    });
    // A host with no file manager to call (a bare Linux box, WSL without interop) used to look
    // exactly like a successful reveal — the route said ok and nothing appeared (#1447).
    if (!res.ok) showAskMsg(openDirFailureText(await jsonBody(res), res.status));
  } catch (e) {
    showAskMsg(`Could not open the folder: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const openDirFailureText = (body: Record<string, unknown>, status: number): string =>
  typeof body.error === "string" && body.error.length > 0 ? body.error : `Could not open the folder (HTTP ${status}).`;

// The server reports where the PTY actually runs (it may have rejected the
// requested dir). Adopt it as the truth — display and persist the effective cwd.
function onServerCwd(c: string) {
  cwd.value = c;
  // Only a user-initiated fresh launch records the dir as a preset chip — not a
  // reconnect/restore of an already-running session (see recordNextCwd).
  if (recordNextCwd) {
    recordNextCwd = false;
    emit("record-cwd", c);
  }
  emit("cwd", c);
}

// "Open on GitHub": when this cell's dir is a GitHub repo, the server returns its
// repository URL (null otherwise) and the header shows a popover linking to the
// repo top page / Issues / Pull requests. Refreshed whenever the effective cwd
// changes (launch, server-confirmed cwd, restore).
const githubUrl = ref<string | null>(null);
const pathMenuOpen = ref(false);
const pathWrap = useTemplateRef<HTMLElement>("pathWrap");
let githubReq = 0; // request token: drop out-of-order responses (cwd can change fast)

async function refreshGithubUrl() {
  pathMenuOpen.value = false;
  const reqId = ++githubReq;
  if (!cwd.value) {
    githubUrl.value = null;
    return;
  }
  try {
    const res = await fetchWithTimeout(
      "/api/git-remote",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: cwd.value }),
      },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    if (reqId !== githubReq) return; // a newer cwd superseded this lookup
    const data = res.ok ? await jsonBody(res) : {};
    if (reqId !== githubReq) return; // re-check after awaiting the body
    githubUrl.value = typeof data.githubUrl === "string" ? data.githubUrl : null;
  } catch {
    if (reqId === githubReq) githubUrl.value = null; // best-effort — the link just won't appear
  }
}
watch(cwd, refreshGithubUrl, { immediate: true });

// Repository top page (""), Issues, or Pull requests — opened in a new tab.
function openGithub(suffix: string) {
  if (!githubUrl.value) return;
  window.open(githubUrl.value + suffix, "_blank", "noopener,noreferrer");
}

// The in-app file browser and a new terminal in this directory — the `files` and `terminal` buttons
// that used to sit on this row.
//
// `newTerminalHere` goes through the same helper the header buttons dispatch to (useHeaderAction),
// rather than being re-implemented, so the menu and a user's own configured button for it cannot
// drift apart. `afterSlotKey` places the new terminal next to this cell, which is the whole point
// of "here"; it is this cell's durable-connection slot key (see persist-key).
//
// Files deliberately does NOT any more (#1910): it asks the GRID for the pane beside this cell,
// which is somewhere only the grid can put it. A user's own `open.files` button still opens the
// full-screen view, and has to — it carries an arbitrary path, while the pane can only ever be
// rooted at the enlarged cell (see FilesPane's defineExpose contract: it never watches its `cwd`).
function browseFiles() {
  emit("open-files");
}
function newTerminalHere() {
  if (cwd.value) openTerminalAt(cwd.value, `cell-${props.uid}`);
}

// The shared menu row plus this menu's own layout: every item leads with an icon, so the labels
// line up and the four navigations are told apart by glyph the way they were as buttons.
const PATH_MENU_ITEM = `inline-flex items-center gap-2 whitespace-nowrap ${CELL_MENU_ITEM}`;

// Closing puts focus back where it came from. The trigger is the only thing in this wrapper that
// survives the close, and leaving focus on a removed menu item drops the keyboard to the top of the
// document — which is why Escape has to do more than flip the flag.
const pathTrigger = useTemplateRef<HTMLElement>("pathTrigger");
function closePathMenu() {
  if (!pathMenuOpen.value) return;
  pathMenuOpen.value = false;
  void nextTick(() => pathTrigger.value?.focus());
}

// Every item closes the menu, so no item has to remember to.
function pathMenuAction(run: () => void) {
  closePathMenu();
  run();
}

function onPathOutside(e: MouseEvent) {
  if (pathWrap.value && !(e.target instanceof Node && pathWrap.value.contains(e.target))) pathMenuOpen.value = false;
}
watch(pathMenuOpen, (open) => {
  if (open) document.addEventListener("mousedown", onPathOutside);
  else document.removeEventListener("mousedown", onPathOutside);
});
onUnmounted(() => document.removeEventListener("mousedown", onPathOutside));

// "Bring another cell's last turn here": pull a sibling terminal's last completed
// exchange into THIS cell's input box, so the two agents can be pointed at each other's
// work without the user copying text between panes. Pulling rather than pushing keeps
// the click and the Enter in one place (#574). The source list is a snapshot taken when
// the menu opens, so it reflects what is connected right now.
const askMenuOpen = ref(false);
const askWrap = useTemplateRef<HTMLElement>("askWrap");
const askTargets = ref<HandoffTarget[]>([]);
const askMsg = ref<string | null>(null);
let askMsgTimer: ReturnType<typeof setTimeout> | null = null;

// Measured at OPEN, not bound to a CSS length: the menu hangs off a button partway down the
// screen, so "how tall may it be" is the space left beside that button, which no viewport unit
// knows (#2003 — a `100vh` cap still left Start below the fold on a bottom-row cell).
const askMenuUp = ref(false);
const askMenuMaxH = ref<number | null>(null);

function openAskMenu() {
  askTargets.value = handoffTargets(`cell-${props.uid}`, props.home);
  askMenuOpen.value = !askMenuOpen.value;
  if (!askMenuOpen.value) return;
  // `askWrap` wraps the button AND the menu, but the menu is absolutely positioned and so adds
  // nothing to the wrapper's box — measured. That is what makes this safe to read here rather
  // than after a re-render: the number is the trigger's either way.
  const rect = askWrap.value?.getBoundingClientRect();
  // No rect (not laid out yet, or jsdom) leaves both unset, which is the pre-#2003 behaviour:
  // an unbounded menu is wrong, but a menu clamped to a height invented from nothing is worse.
  if (!rect) {
    askMenuUp.value = false;
    askMenuMaxH.value = null;
    return;
  }
  const placement = menuPlacement(rect, window.innerHeight);
  askMenuUp.value = placement.up;
  askMenuMaxH.value = placement.maxHeightPx;
}

function showAskMsg(msg: string) {
  askMsg.value = msg;
  if (askMsgTimer) clearTimeout(askMsgTimer);
  askMsgTimer = setTimeout(() => (askMsg.value = null), ASK_MSG_MS);
}

async function askCell(target: HandoffTarget) {
  askMenuOpen.value = false;
  const error = await pullLastTurn(target, `cell-${props.uid}`);
  if (error) showAskMsg(error);
}

// Only ONE automation may type into terminals at a time. Both loops submit with pasteAndSubmit
// and both decide "is this reply ours" by correlating on the tail of what they sent — so two
// running together interleave their writes and each can take the other's turn as its own answer.
// They used to gate only on themselves, which left both orders reachable from this one menu
// (Codex review on #1456).
const automating = computed(() => exchanging.value || tableRunning.value);

// One automatic exchange: our turn goes out, their answer comes back, both submitted.
// `exchangeStop` is the only way a running exchange ends early, so it is also what the
// cell unmounting sets — a loop typing into terminals must not outlive its cell.
const exchanging = ref(false);
let exchangeStop = false;

function stopExchange() {
  exchangeStop = true;
}

async function exchangeWith(target: HandoffTarget) {
  askMenuOpen.value = false;
  if (!sessionId.value || automating.value) return;
  exchanging.value = true;
  exchangeStop = false;
  const self = { key: `cell-${props.uid}`, source: { sessionId: sessionId.value, cwd: cwd.value, agent: agent.value } };
  const { outcome } = await runOneExchange(
    self,
    target,
    liveCrossTalkDeps(() => exchangeStop),
  );
  exchanging.value = false;
  const message = outcomeMessage(outcome);
  if (message) showAskMsg(message);
}

// A round table: the same machinery as one exchange, run round N cells until the group says it is
// done or the budget runs out (#1456). `tableStop` is the only way a running table ends early, so
// it is what unmounting sets too — a loop typing into terminals must not outlive its cell.
const tableRunning = ref(false);
// The room the running table writes to, so the picker can offer to open it while it fills up.
const tableRoom = ref<string | null>(null);
let tableStop = false;

function stopTable() {
  tableStop = true;
}

// The menu deliberately stays OPEN: it is where both of the things you want next live — stop, and
// read the conversation as it fills up. It still closes on the next click outside.
async function startTable(targets: HandoffTarget[], budget: number, room: string) {
  if (!sessionId.value || automating.value) return;
  tableRunning.value = true;
  tableRoom.value = room;
  tableStop = false;
  // The SAME label shape the other seats get. It was a bare `#0` while everyone else read
  // `#1 · codex · …/proj`, so the framing told codex "Also at the table: #0" and named something
  // the reader could not identify (seen in the first live run).
  const source = { sessionId: sessionId.value, cwd: cwd.value, agent: agent.value };
  const key = `cell-${props.uid}`;
  const self: TableMember = { key, label: slotLabel({ key, ...source }, props.home), source };
  const { outcome, turnsTaken } = await runRoundTable(
    [self, ...targets.map(memberFromTarget)],
    room,
    budget,
    liveRoundTableDeps(() => tableStop),
  );
  tableRunning.value = false;
  showAskMsg(`${roundTableMessage(outcome)} · ${turnsTaken} turn${turnsTaken === 1 ? "" : "s"}`);
}

function onAskOutside(e: MouseEvent) {
  if (askWrap.value && !(e.target instanceof Node && askWrap.value.contains(e.target))) askMenuOpen.value = false;
}
watch(askMenuOpen, (open) => {
  if (open) document.addEventListener("mousedown", onAskOutside);
  else document.removeEventListener("mousedown", onAskOutside);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onAskOutside);
  tableStop = true;
  if (askMsgTimer) clearTimeout(askMsgTimer);
  exchangeStop = true; // never leave an exchange typing into terminals after this cell is gone
});

// Reap the session and reset the cell back to the empty launcher. The cell isn't
// remounted (stable key), so the dir/diff state is reset explicitly — otherwise the
// launch form would still show the closed session's directory.
function teardown() {
  // FIRST, and here rather than only in onUnmounted: closing a cell does not unmount this
  // component — it goes back to the launch form — so an automation started from it would keep
  // polling and could submit another turn into the OTHER cells after the user closed this one
  // (Codex review on #1456). Both loops read their flag before every submit.
  exchangeStop = true;
  tableStop = true;
  const id = sessionId.value; // capture before the reset below nulls it
  termRef.value?.terminate();
  // Reap on the server over HTTP too — the WS `terminate` only reaches the server while
  // the socket is open, so a disconnected cell's close button would otherwise leave its tmux alive.
  // Not awaited, unlike the restart's: this cell is going back to its launch form either way.
  if (id) void reapSessionOnServer(id);
  launched.value = false;
  recordNextCwd = false; // drop any pending fresh-launch record from a torn-down session
  sessionId.value = null;
  working.value = false;
  waiting.value = false;
  activityEvent.value = null;
  lastPrompt.value = null;
  aiTitle.value = null;
  // The memo belongs to the SESSION, not to the cell — it stays on disk and comes back when that
  // session is resumed. What must not survive is showing it against whatever this cell runs next.
  memo.value = null;
  memoEditing.value = false;
  collection.value = null;
  usage.value = null;
  context.value = null;
  cwd.value = props.defaultCwd;
  dirInput.value = props.defaultCwd ?? "";
  dirTouched.value = false; // fresh launcher again — let a late preset sync re-prefill
  diff.value = null;
  diffOpen.value = false;
  closeConfirm.value = false;
  prMsg.value = null;
  emit("close");
  // The launch form is mounted fresh by the `v-else` this just switched back to, and reads its
  // own lists for the directory above on the way in.
}

// Restart the agent in this cell (#1918): end the session server-side, then point this same cell
// at the same session id again. The server has nothing live to attach to, so it spawns a NEW
// process and resumes the conversation from its transcript — which is what makes a changed MCP
// registration, config file or plugin take effect. Nothing about the cell changes.
//
// `connectKey++` rather than resumeSession(): that one is the launcher ATTACHING to a session
// someone picked from a list, and it re-emits the agent with `customAgent: null` — which would
// take a session started through a custom agent off its wrapper (a different model). Bumping the
// key retargets the slot with everything the cell already holds.
//
// No confirmation, even mid-turn: the only ways here are a header button and a shortcut the user
// put in their own config.
const restarting = ref(false);
const RESTART_FAILED_EN = "Couldn't end the old session, so nothing was restarted — try again, or close the cell.";
async function restart(): Promise<void> {
  // A worktree removal is running or waiting to be confirmed — that flow owns the pty. A restart
  // never opens that dialog itself: it discards nothing, so there is nothing to confirm.
  if (restarting.value || closeConfirm.value || closeBusy.value !== null) return;
  restarting.value = true;
  const id = sessionId.value; // what this restart is FOR — the cell can move on while it runs
  // The reap is a round trip, and a cell can be closed and relaunched inside it. Whatever the
  // answer, it is then about a session this cell no longer holds: reconnecting would retarget the
  // REPLACEMENT (at worst one whose id the server has not sent yet, spawning a second session and
  // orphaning it), and the failure banner would tell a fresh agent that it was not restarted
  // (codex on #1920, both halves).
  const stale = (): boolean => !launched.value || sessionId.value !== id;
  try {
    const outcome = await restartSession(id, {
      reap: reapSessionOnServer,
      reconnect: () => {
        if (stale()) return;
        // The turn that was in flight died with the process; the resumed session publishes its own.
        working.value = false;
        waiting.value = false;
        activityEvent.value = null;
        connectKey.value++;
      },
    });
    // Nothing was reconnected and the old agent is probably still running, which looks identical to
    // a restart that worked. Say so over the terminal, where the header button's other failures go.
    if (outcome === "reap-failed" && !stale()) void termRef.value?.showHint(RESTART_FAILED_EN, "restart_alt");
  } finally {
    restarting.value = false;
  }
}

// Both ways in — a `run: "action"` header button and the `terminal-restart` shortcut — land here.
// False while this cell is still on its launch form, so the caller can say so rather than leaving
// a button that silently does nothing.
onUnmounted(
  registerCellRestart(`cell-${props.uid}`, () => {
    if (!launched.value || !sessionId.value) return false;
    void restart();
    return true;
  }),
);

// Closing a WORKTREE cell offers to keep or remove the room first (never silently
// discards uncommitted/unpushed work); other cells just tear down.
// "Its PR merged — tidy up?" (#1182). Offered rather than done: the close flow below already asks
// keep-or-remove and refuses to discard unsaved work, so this only has to get the user there.
const dismissedTidyPr = ref<number | null>(null);
const promptTidy = computed(() =>
  shouldPromptTidy({ phase: workItem.value.phase, pr: workItem.value.pr, isWorktree: isWorktreeCell.value, dismissedPr: dismissedTidyPr.value }),
);
const dismissTidy = () => (dismissedTidyPr.value = workItem.value.pr);

const closeConfirm = ref(false);
const closeChecking = ref(false); // refreshing dirty/ahead — the destructive action is held until it's accurate
const closeError = ref<string | null>(null);
const unsaved = computed(() => unsavedWork(diff.value));
const hasUnsaved = computed(() => unsaved.value.has);
const unsavedSummary = computed(() => unsaved.value.summary);

async function close() {
  if (!isWorktreeCell.value) {
    teardown();
    return;
  }
  // The header's own close button is not covered by the overlay. Re-entering while a removal runs
  // would clear the error the removal is about to write.
  if (closeBusy.value !== null) return;
  closeError.value = null;
  closeConfirm.value = true;
  // Refresh dirty/ahead before the Remove button is enabled, so a fast click can't
  // discard work that became newly dirty/ahead since the last refresh.
  closeChecking.value = true;
  await loadDiff();
  closeChecking.value = false;
}

// Nothing dismisses the confirmation once the removal has started. The pty is terminated before the
// route is even called, so a dialog that closes here would claim the worktree was kept while it is
// being deleted — and would take its failure off the screen with it (Codex and CodeRabbit, #1550).
// Guarded in the shared function rather than on the button, because Escape reaches it too.
function cancelClose() {
  if (closeBusy.value !== null) return;
  closeConfirm.value = false;
  closeChecking.value = false;
  closeError.value = null;
}

// `git worktree remove` on a large repository takes seconds, and the confirmation stays on screen
// for all of them — so the button holds itself and says so, rather than terminating the pty and
// firing a second removal on the next impatient click (#1549's rule, same route).
const { busy: closeBusy, run: runCloseAction } = useBusyAction();
const REMOVE_KEY = "remove";

// `git worktree remove` runs for seconds on a large repository, and until #1551 the only thing
// saying so was a 12px label inside the dialog — the cell itself, header and all, went on looking
// live. This is what fades it and puts the spinner over it.
const removingWorktree = computed(() => closeBusy.value === REMOVE_KEY);

// The three things this one button is doing at any moment: waiting for an accurate dirty/ahead
// count, running the removal, or offering it.
const removeButtonLabel = computed(() => {
  if (closeChecking.value) return "Checking…";
  if (removingWorktree.value) return "Removing…";
  return hasUnsaved.value ? "Discard & remove" : "Remove worktree";
});

async function removeAndClose() {
  const dir = cwd.value;
  if (!dir) {
    teardown();
    return;
  }
  await runCloseAction(REMOVE_KEY, () => requestRemove(dir));
}

async function requestRemove(dir: string) {
  closeError.value = null;
  termRef.value?.terminate(); // free the worktree dir first (Windows locks a process's cwd)
  try {
    const res = await fetchWithTimeout(
      "/api/worktrees/remove",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoDir: dir, path: dir, deleteBranch: true, force: true }),
      },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    if (res.ok) return teardown();
    closeError.value = `Couldn't remove the worktree: ${worktreeRequestFailure(await jsonBody(res), res.status)} — it may need manual cleanup.`;
  } catch {
    closeError.value = "Couldn't reach the server to remove the worktree.";
  }
}

// Esc dismisses the close confirmation (document-scoped: focus may be on the
// terminal, not the overlay), matching the diff panel's Escape handling.
function onCloseKey(e: KeyboardEvent) {
  if (e.key === "Escape") cancelClose();
}
watch(closeConfirm, (open) => {
  if (open) document.addEventListener("keydown", onCloseKey);
  else document.removeEventListener("keydown", onCloseKey);
});
onUnmounted(() => document.removeEventListener("keydown", onCloseKey));

// Adopt the server-assigned id (esp. for new sessions), bubble it up for
// persistence, and load its initial activity.
function onSession(id: string) {
  sessionId.value = id;
  emit("session", id);
  void loadInitial(id);
}

// ~-anchored, front-truncated path for the header (keeps the tail). For a managed
// worktree cell, show "⎇ <repo> (<task>)" instead — the managed path is just noise.
const dirDisplay = computed(() => formatCwd(cwd.value, props.home));
const headerDir = computed(() => {
  const wt = worktreeLabel(cwd.value);
  return wt ? `⎇ ${wt.repo} (${wt.task})` : dirDisplay.value;
});

// blocked (needs input) / done (finished, unreviewed) / working / idle — split from
// the server's working+waiting+event (see activityStatus).
const status = computed<AttentionStatus>(() => activityStatus(working.value, waiting.value, activityEvent.value));
const STATUS_CLASS = { blocked: "is-blocked", done: "is-done", working: "is-working", idle: "is-idle" } as const;
const STATUS_LABEL = { blocked: "Needs input", done: "Done — review", working: "Working…", idle: "Idle" } as const;
const statusClass = computed(() => STATUS_CLASS[status.value]);
// The is-* class stays on the element as a state marker (the specs assert it); the styling that
// used to live in the .cell.is-* / .cell-header.is-* rules is in cellStatusClasses.ts.
const cellStatusClass = computed(() => CELL_STATUS[status.value]);
const headerStatusClass = computed(() => HEADER_STATUS[status.value]);
// The directory's header colours — computed here rather than taken from useCellChrome because only
// this cell's header background is REPLACED by a status tint, so what it paints depends on the
// status and on what the user configured for that status (common/headerStatusColors.ts).
//
// The global config is the fallback for each of the two KEYS, not for each status inside them: a
// directory that names any `headerStatusColors` replaces the global block entire, so the statuses
// it leaves out fall through to the theme rather than to the global entry for that status
// (mergeHeaderStatusColors states why, and a spec pins it).
const headerStyle = computed(() =>
  headerStatusStyleFor(status.value, {
    headerColor: dirConfig.value.headerColor,
    headerTextColor: dirConfig.value.headerTextColor,
    statusColors: mergeHeaderStatusColors(globalHeaderStatusColors.value, dirConfig.value.headerStatusColors),
    tint: dirConfig.value.headerStatusTint ?? globalHeaderStatusTint.value,
  }),
);
// Set aside, and not stopped waiting for an answer (see cellParked.ts). Enlarging it does NOT
// bring it back — that is how you look at a parked session without waking it.
const parked = computed(() => props.parked === true);
const sunk = computed(() => isCellSunk(parked.value, status.value));
// Both reasons the cell body is faded — set aside, and on its way out (#1551) — resolved to ONE
// class. Two opacity utilities on one element are settled by Tailwind's output order rather than
// by intent, which is the rule SUNK_CELL's own comment sets.
const fadedClass = computed(() => (sunk.value || removingWorktree.value ? SUNK_CELL : ""));
const togglePark = () => emit("park", !parked.value);
// Typing into it is the un-parking gesture. Guarded on `parked` so an awake cell does not ask the
// grid to rewrite its state on every keystroke.
const onTerminalInput = (): void => {
  if (parked.value) emit("park", false);
};
const dotStatusClass = computed(() => (sunk.value ? SUNK_DOT_STATUS : DOT_STATUS)[status.value]);
// This session raised a notification nothing announced — the audio was still locked, or the row
// arrived as the page's first sighting and was swallowed as baseline (#1152). A ring on the dot
// rather than a new element: it has to be legible in a filmstrip thumbnail, and the header track
// is already full.
const { isMissed, acknowledge: acknowledgeMissed } = useMissedAttention();
const missedNotify = computed(() => isMissed(sessionId.value));
const dotMissedClass = computed(() => (missedNotify.value ? "ring-2 ring-amber ring-offset-2 ring-offset-[var(--cell-header-bg,var(--bg-panel))]" : ""));
const statusLabel = computed(() => (missedNotify.value ? `${STATUS_LABEL[status.value]} (missed while sound was unavailable)` : STATUS_LABEL[status.value]));
// Enlarging the cell IS the acknowledgement — the user is now looking at the session the mark
// was pointing them to. All three inputs are watched, not just the expand edge: a cell that is
// ALREADY enlarged can connect (or relaunch into) its session afterwards, and a notification can
// be suppressed for the session the user is currently staring at. Either would otherwise leave a
// ring pointing at the pane already on screen.
watch(
  () => [props.expanded, sessionId.value, missedNotify.value] as const,
  ([expanded, id, missed]) => {
    if (expanded && missed) acknowledgeMissed(id);
  },
  { immediate: true },
);
watch(status, (s) => emit("status", s), { immediate: true });

const headerText = computed(() => cellHeaderText(memo.value, aiTitle.value, lastPrompt.value, sessionId.value));
// A memo displaces the AI title from the line, so the tooltip is where that title goes — losing
// it entirely would make the note cost information rather than add it. With no memo the tooltip
// is what it always was: the raw prompt, which the header abbreviates.
const headerTitleAttr = computed(() => (memo.value ? aiTitle.value || lastPrompt.value || "" : lastPrompt.value || aiTitle.value || ""));

const memoInput = useTemplateRef<HTMLInputElement>("memoInput");

function startMemoEdit() {
  if (!sessionId.value) return; // a launcher cell has no session to hang a note on yet
  memoDraft.value = memo.value ?? "";
  memoEditing.value = true;
  void nextTick(() => memoInput.value?.select());
}

function cancelMemoEdit() {
  memoEditing.value = false;
}

// Enter here has to mean "confirm the IME candidate" while a conversion is open, or a note typed in
// Japanese is saved half-converted and the box closes on the first press with no way back (#1353).
const memoIme = useImeAwareEnter(() => void saveMemo());

// One plain `keydown` rather than Vue's `.enter` / `.escape` modifiers: the composable reads
// `event.key` itself, which is what the modifiers do — but binding them here would put the
// modifier's own `.prevent` ahead of the IME decision, and the whole point is that the decision
// comes first.
function onMemoKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    // Escape mid-composition drops the candidate. Closing the editor on it would throw away the
    // sentence the user is still writing, which is worse than the Enter case it mirrors.
    if (memoIme.isImeConfirmation(event)) return;
    event.preventDefault();
    cancelMemoEdit();
    return;
  }
  memoIme.onKeydown(event);
}

// Blur still saves — clicking away is the ordinary way to leave a text field. The composable's own
// blur only clears its composition state, so a stale "mid-composition" flag cannot outlive the box.
function onMemoBlur() {
  memoIme.onBlur();
  void saveMemo();
}

// Save, then let the server's answer win: it normalizes and caps, so what is shown here after a
// save is what a reload will show. Blur saves too — closing the box by clicking away is the
// ordinary way to leave a text field, and losing the sentence to it would be the bug.
async function saveMemo() {
  if (!memoEditing.value) return; // Enter or Escape already closed it; the blur that follows is not a second save
  const id = sessionId.value;
  memoEditing.value = false;
  if (!id) return;
  const text = normalizeMemo(memoDraft.value);
  if (text === (memo.value ?? "")) return; // unchanged — an append log should not grow for a no-op
  const previous = memo.value;
  memo.value = text || null;
  try {
    const res = await fetchWithTimeout(`/api/session/${encodeURIComponent(id)}/memo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`memo save failed: ${res.status}`);
    const data: unknown = await res.json();
    const saved = isRecord(data) ? data.memo : null;
    if (sessionId.value === id && typeof saved === "string") memo.value = saved || null;
  } catch {
    // Put back what the server still has, rather than leaving a note on screen that no other
    // tab — and no reload — will ever show.
    if (sessionId.value === id) memo.value = previous;
  }
}

// Per-cell token usage badge: ⇡ total input (fresh + cache) · ⇣ output generated.
const usageView = computed(() => usageBadge(usage.value));
const showUsage = computed(() => usageView.value.show);
const usageLabel = computed(() => usageView.value.label);
const usageTitle = computed(() =>
  usage.value
    ? `Tokens — input ${usage.value.inputTokens.toLocaleString()} · cache ${(usage.value.cacheReadTokens + usage.value.cacheCreationTokens).toLocaleString()} · output ${usage.value.outputTokens.toLocaleString()}`
    : "",
);

// Worktree diff (read-only): for a launched worktree cell, show how much the agent
// changed vs the base branch — a header badge (ahead/dirty) and a panel (changed
// files + patch). Refreshed when the agent pauses (the change set is then stable).
interface WorktreeDiffData {
  isWorktree: boolean;
  base: string | null;
  ahead: number;
  dirty: number;
  files: { path: string; additions: number; deletions: number; status: "changed" | "untracked" }[];
  patch: string;
  truncated: boolean;
}
// The diff arrives off /api/worktrees/diff; the badge and the overlay read every field, so a
// response that is missing one is treated as "no diff" rather than rendered with holes.
const isWorktreeDiffData = (value: unknown): value is WorktreeDiffData =>
  isRecord(value) &&
  typeof value.isWorktree === "boolean" &&
  (value.base === null || typeof value.base === "string") &&
  typeof value.ahead === "number" &&
  typeof value.dirty === "number" &&
  isUnknownArray(value.files) &&
  typeof value.patch === "string" &&
  typeof value.truncated === "boolean";

const diff = ref<WorktreeDiffData | null>(null);
const diffOpen = ref(false);
const isWorktreeCell = computed(() => worktreeLabel(cwd.value) !== null);
const showDiffBadge = computed(() => !!diff.value?.isWorktree && (diff.value.ahead > 0 || diff.value.dirty > 0));
let diffReq = 0;

async function loadDiff() {
  if (!launched.value || !isWorktreeCell.value || !cwd.value) {
    diffReq++; // invalidate any in-flight fetch so its (now stale) response can't land
    diff.value = null;
    diffOpen.value = false; // fully close — don't auto-reopen on a later worktree re-entry
    return;
  }
  const reqId = ++diffReq;
  try {
    const res = await fetchWithTimeout(`/api/worktrees/diff?cwd=${encodeURIComponent(cwd.value)}`, undefined, SLOW_COMMAND_TIMEOUT_MS);
    if (reqId !== diffReq) return;
    const data = res.ok ? await jsonBody(res) : {};
    if (reqId !== diffReq) return;
    diff.value = isWorktreeDiffData(data) && data.isWorktree ? data : null;
  } catch {
    if (reqId === diffReq) diff.value = null;
  }
}

function openDiff() {
  diffOpen.value = true;
  prMsg.value = null;
  void loadDiff(); // refresh on open
}

// Outward-facing actions (push / open PR) for the worktree's branch. `prBusy`
// disables the buttons during a request; `prMsg` shows the result inline.
const prBusy = ref(false);
const prMsg = ref<string | null>(null);

// Ask the cell's own Claude session to commit the uncommitted changes (so it writes
// a sensible message). After it commits and settles, the working→idle watch
// refreshes the diff: `ahead` rises, `dirty` drops, and Push/PR light up.
const COMMIT_PROMPT = "Commit all current changes in this worktree with a concise, descriptive commit message.";
function commitViaClaude() {
  const delivered = termRef.value?.submitText(COMMIT_PROMPT);
  prMsg.value = delivered ? "Asked Claude to commit…" : "Couldn't reach the session";
}

// The refusal reason as the message table can use it. The response is untrusted JSON, so a
// non-string `reason` reads as absent and the caller shows the generic "Failed".
const reasonOf = (data: Record<string, unknown>): string | null => (typeof data.reason === "string" ? data.reason : null);

async function worktreeAction(endpoint: "push" | "pr"): Promise<Record<string, unknown> | null> {
  if (!cwd.value || prBusy.value) return null;
  prBusy.value = true;
  prMsg.value = endpoint === "push" ? "Pushing…" : "Creating PR…";
  try {
    const res = await fetchWithTimeout(
      `/api/worktrees/${endpoint}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: cwd.value }),
      },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    // jsonBody answers {} for a non-JSON / empty body (e.g. a 403 from the origin guard); an
    // empty answer must not leave the UI stuck on the optimistic "Pushing…" text.
    const data = await jsonBody(res);
    const empty = Object.keys(data).length === 0;
    if (empty) prMsg.value = res.status === 403 ? "Not allowed (origin)" : "Request failed";
    return empty ? null : data;
  } catch {
    prMsg.value = endpoint === "push" ? "Push failed" : "PR failed";
    return null;
  } finally {
    prBusy.value = false;
  }
}

async function pushBranch() {
  const data = await worktreeAction("push");
  if (data) prMsg.value = data.ok ? `Pushed ${data.branch}` : worktreeFailureMessage(reasonOf(data));
}

async function openPR() {
  const data = await worktreeAction("pr");
  if (!data) return;
  if (data.ok && typeof data.url === "string") {
    window.open(data.url, "_blank", "noopener,noreferrer");
    prMsg.value = data.via === "cli" ? "PR created" : "Opened PR page";
  } else {
    prMsg.value = worktreeFailureMessage(reasonOf(data));
  }
}

// Refresh when the agent transitions from working → settled: that's when the diff
// is stable and worth re-reading (avoids churn while it's actively editing), and the
// turn's token usage is final.
watch(working, (now, prev) => {
  if (prev && !now) {
    void loadDiff();
    void refreshUsage();
    void refreshGit(); // branch/dirty may have changed (commit, checkout, edits)
    void refreshWorkItem(); // a turn that pushed or opened a PR changes what this cell is on
  }
});

// Re-read (or clear) the diff when the effective cwd changes — e.g. the server
// confirmed a fallback dir. loadDiff() clears it synchronously for a non-worktree
// dir, so the badge never lingers with a previous worktree's counts.
watch(cwd, () => loadDiff());

// Esc closes the diff panel. Listen at document scope while it's open: focus is
// usually on the badge or the terminal, so a handler on the panel element itself
// wouldn't reliably receive the keydown.
function onDiffKey(e: KeyboardEvent) {
  if (e.key === "Escape") diffOpen.value = false;
}
watch(diffOpen, (open) => {
  if (open) document.addEventListener("keydown", onDiffKey);
  else document.removeEventListener("keydown", onDiffKey);
});
onUnmounted(() => document.removeEventListener("keydown", onDiffKey));
</script>

<template>
  <div
    class="group/cell cell relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-[var(--cell-bg,var(--bg-base))]"
    :class="[statusClass, cellStatusClass]"
    :style="cellStyle"
  >
    <!-- The sink rides on CELL_INNER, which already wraps every child including the header, so
         one property covers the whole cell. Opacity alone: the status branches own the borders,
         backgrounds and ink, and two utilities for one property are settled by Tailwind's
         output order rather than by intent. -->
    <!-- A worktree being deleted, over the WHOLE cell — a sibling of `.cell-inner` rather than a
         child, so it is not dimmed by the layer it is dimming, and so it reaches the header, which
         the close-confirm overlay inside never did. -->
    <div
      v-if="removingWorktree"
      data-testid="cell-removing"
      class="absolute inset-0 z-[30] flex flex-col items-center justify-center gap-2 bg-[color-mix(in_srgb,var(--bg-base)_70%,transparent)]"
      role="status"
      :aria-label="`Removing worktree ${headerDir}`"
    >
      <span class="material-symbols-outlined animate-spin text-[30px] text-secondary" aria-hidden="true">progress_activity</span>
      <span class="max-w-full truncate px-3 font-sans text-[12px] text-secondary">Removing {{ headerDir }}…</span>
    </div>
    <!-- `inert` while the removal runs, not just faded: the veil above stops the mouse and nothing
         else, so Tab still walked into the header buttons and the terminal's own textarea behind
         it, and a screen reader still read a cell that is being deleted (Codex, #1552).
         `|| undefined` rather than the boolean — `inert` is Booleanish to Vue, so `false` reaches
         the DOM as inert="false", which is an inert element (the trap TerminalGrid's zoom-main
         hit on #1333). -->
    <div class="cell-inner" :class="[CELL_INNER, fadedClass]" :inert="removingWorktree || undefined">
      <template v-if="launched">
        <!-- Filmstrip thumbnail: the same roster header (CockpitHeader) — the dir colour is applied
           regardless of status (status is the dot + badge), so a thumbnail reads as its directory
           the way the roster row does. Expand/close go in its trailing slot. -->
        <CockpitHeader
          v-if="filmstrip"
          class="cell-header flex-none border-b"
          :class="[statusClass, expanded ? '' : `is-zoomable ${CELL_HEADER_ZOOMABLE}`]"
          :status="status"
          :agent="agent"
          :cwd="cwd"
          :home="home"
          :header-color="dirConfig.headerColor"
          :header-text-color="dirConfig.headerTextColor"
          :icon-url="dirConfig.iconUrl"
          :collection="collection"
          @click="onHeaderClick"
        >
          <span class="cell-actions" :class="CELL_ACTIONS">
            <CellChromeButtons v-bind="chromeProps" :can-park="true" :parked="parked" v-on="chromeEvents" @toggle-park="togglePark" />
          </span>
        </CockpitHeader>
        <!-- Row 1 — the CELL (normal grid / expanded): what it is (dir + git + model/token + what
           it's doing) and what you can do to the cell itself (reorder / expand / park / close).
           Row 2 — the embedded terminal's header, via its slot — is the SESSION: everything that
           acts on the agent running inside. The split is scope, not info-vs-action: row 2 is gone
           entirely on a filmstrip thumbnail, so anything a cell needs whether or not it holds a
           live session has to be here.
           Row 1 has two design languages, both deliberate: CELL_BTN for the cell controls pinned
           right, and CELL_CHIP_BTN for the pressable chips in the info track (canvas unread, diff,
           the note pencil) — those are sized like the chips they sit among so a cell with a note
           is exactly as tall as one without. -->
        <div
          v-else
          class="cell-header flex h-[34px] flex-none items-center gap-2 border-b px-2"
          :class="[statusClass, headerStatusClass, expanded ? '' : `is-zoomable ${CELL_HEADER_ZOOMABLE}`]"
          :style="headerStyle"
          @click="onHeaderClick"
        >
          <!-- All the info lives in one shrinkable, clipping track. The chips (badge / git /
             model / tokens / custom) don't shrink, so without this they would overflow and
             push the actions past the cell's `overflow: hidden` edge — the buttons must
             stay reachable no matter how much a dir's config crams in here. -->
          <div data-testid="cell-header-main" class="flex min-w-0 flex-auto items-center gap-2 overflow-hidden">
            <!-- Leading the row, ahead of the status dot: this is the browser-tab position, and a
                 project icon is read the way a favicon is — you find the tab by its picture before
                 you read anything. Everything after it says what the cell is DOING; the icon says
                 which project it is, and that is the first question. -->
            <DirIcon :src="dirConfig.iconUrl" />
            <span class="cell-dot" :class="[CELL_DOT, statusClass, dotStatusClass, dotMissedClass]" :title="statusLabel" />
            <!-- After the dot, not instead of the picture before it: the icon says which PROJECT,
                 this says which COLLECTION, and a chat started from one runs in the workspace — so
                 replacing it would leave the row unable to say where the agent is standing. Kept
                 on the filmstrip thumbnail too (the CockpitHeader above), unlike the info chips
                 below, because it is identity rather than status. -->
            <CollectionMark :collection="collection" />
            <!-- The path is NOT here any more — it is the lead item on row 2 (see the
               `header-lead` template below). It had `min-w-[16ch]`, a floor of roughly a third of
               this track, and once it hit that floor the only thing left that could shrink was the
               note. This row is what you scan across nine cells; the path is what you read about
               the one in front of you, and row 2 is 34px away, not hidden. -->
            <!-- Info (dir badge / git / diff / model / tokens) is dropped on a filmstrip
               thumbnail, leaving only dir + what it's doing + a zoom button. -->
            <template v-if="!filmstrip">
              <DirBadge :name="dirConfig.name" :color="dirConfig.badgeColor" :workspace="isWorkspace" />
              <!-- Unread Canvas output. Same chip vocabulary as the branch / context / token
                   chips beside it, deliberately: this is one more thing to triage at a glance,
                   not a new kind of alert. Clicking expands the cell with the pane open. -->
              <button
                v-if="unseenCanvas > 0"
                type="button"
                data-testid="cell-canvas-chip"
                class="gap-1"
                :class="CELL_CHIP_BTN"
                :title="`${unseenCanvas} unread from the agent — open the canvas`"
                :aria-label="`${unseenCanvas} unread canvas results`"
                @click.stop="emit('open-canvas')"
              >
                <span :class="CELL_CHIP_ICON" aria-hidden="true">draw</span>{{ unseenCanvas }}
              </button>
              <!-- Outside the chip loop on purpose: a prompt rather than a configurable chip, so it
                   appears whether or not the user kept the `work` chip. -->
              <CellTidyPrompt v-if="promptTidy && workItem.pr !== null" :pr="workItem.pr" @tidy="close()" @dismiss="dismissTidy()" />
              <WorkCommentNotice v-if="workCommentNotice" :failure="workCommentNotice" @dismiss="dismissWorkCommentFailure(workCommentNotice)" />
              <template v-for="chip in cellChips" :key="chip.key">
                <GitBranchChip v-if="chip.builtin === 'git'" :status="gitStatus" :hide-dirty="isWorktreeCell" />
                <WorkItemChip v-else-if="chip.builtin === 'work'" :item="workItem" />
                <WorktreeEnvChip v-else-if="chip.builtin === 'env'" :values="worktreeEnv" />
                <button
                  v-else-if="chip.builtin === 'diff' && showDiffBadge && diff"
                  type="button"
                  data-testid="cell-wt-badge"
                  class="gap-1.5"
                  :class="CELL_CHIP_BTN"
                  :title="`View changes vs ${diff.base ?? 'base'}`"
                  @click="openDiff"
                >
                  <span v-if="diff.ahead > 0" data-testid="wt-ahead" class="text-accent">+{{ diff.ahead }}</span>
                  <span v-if="diff.dirty > 0" data-testid="wt-dirty-count" class="text-[var(--warn-text,#e0a030)]">●{{ diff.dirty }}</span>
                </button>
                <ModelContextBadge
                  v-else-if="chip.builtin === 'ctx' && context"
                  :agent="agent"
                  :model="context.model"
                  :context-tokens="context.contextTokens"
                  :context-window="context.contextWindow"
                />
                <span
                  v-else-if="chip.builtin === 'usage' && showUsage"
                  data-testid="cell-usage"
                  class="flex-none whitespace-nowrap font-mono text-[10px] tracking-[0.02em]"
                  :class="CELL_HEADER_INK_DIM"
                  :title="usageTitle"
                  >{{ usageLabel }}</span
                >
                <span
                  v-else-if="chip.custom"
                  data-testid="cell-hdr-chip"
                  class="flex-none whitespace-nowrap rounded-full border border-border px-1.5 py-px text-[10px]"
                  :class="CELL_HEADER_INK_DIM"
                  :title="chip.custom.label || chip.custom.text"
                  >{{ chip.custom.text }}</span
                >
              </template>
            </template>
            <!-- The user's note REPLACES the AI title here rather than adding a row: the header
               keeps one height whatever a cell is doing, and the title it displaced is still in
               the tooltip. -->
            <input
              v-if="memoEditing"
              ref="memoInput"
              v-model="memoDraft"
              data-testid="cell-memo-input"
              class="min-w-0 flex-auto rounded border border-accent bg-input px-1 py-px font-sans text-[12px] text-fg focus:outline-none"
              type="text"
              :maxlength="MEMO_MAX_LENGTH"
              placeholder="What is this session for?"
              aria-label="Note for this session"
              spellcheck="false"
              @click.stop
              @keydown="onMemoKeydown"
              @compositionstart="memoIme.onCompositionStart"
              @compositionend="memoIme.onCompositionEnd"
              @blur="onMemoBlur"
            />
            <span
              v-else
              data-testid="cell-prompt"
              class="min-w-0 flex-auto truncate font-sans text-[12px] text-[var(--cell-header-fg,var(--text-secondary))]"
              :title="headerTitleAttr"
              >{{ headerText }}</span
            >
            <!-- One of the info track's pressable chips (CELL_CHIP_BTN), like the canvas and diff
               badges above: sized like the chips beside it rather than like a header action, so a
               cell with a note is exactly as tall as one without. The ink is the one thing it does
               NOT share — accent once a note exists, so the pencil says whether there is one to
               read when the note itself is scrolled out of a narrow header. -->
            <button
              v-if="sessionId && !memoEditing"
              type="button"
              data-testid="cell-memo-edit"
              :class="[CELL_CHIP_BTN, memo ? 'text-accent' : 'text-dim']"
              :title="memo ? 'Edit this session\'s note' : 'Add a note to this session'"
              :aria-label="memo ? 'Edit this session\'s note' : 'Add a note to this session'"
              @click.stop="startMemoEdit"
            >
              <span :class="CELL_CHIP_ICON" aria-hidden="true">edit_note</span>
            </button>
          </div>
          <!-- The cell's own controls — reorder, expand/restore, park, close — stay on row 1 and
             OUTSIDE the info track, so they're always pinned top-right. They act on the CELL
             (where it sits in the grid, how big it is, whether it lives), not on the session
             inside it, which is what separates them from row 2's actions; that is also why they
             survive when there is no session. Reorder before the chrome buttons, which is the
             order the command and launcher cells already use (CellShell). No `.stop`:
             shouldZoomOnHeaderClick already ignores a click inside a button. -->
          <span class="cell-actions" :class="CELL_ACTIONS">
            <button v-if="reorderable" class="cell-btn" :class="CELL_BTN" title="Move left" aria-label="Move terminal left" @click="emit('move', -1)">
              <span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>
            </button>
            <button v-if="reorderable" class="cell-btn" :class="CELL_BTN" title="Move right" aria-label="Move terminal right" @click="emit('move', 1)">
              <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
            <CellChromeButtons v-bind="chromeProps" :can-park="true" :parked="parked" v-on="chromeEvents" @toggle-park="togglePark" />
          </span>
        </div>
        <TimelineOverlay :session-id="sessionId" :cwd="cwd" :open="timelineOpen" @close="timelineOpen = false" />
        <TerminalView
          ref="termRef"
          class="cell-term"
          :class="CELL_TERM"
          :persist-key="`cell-${uid}`"
          :session-id="sessionId"
          :connect-key="connectKey"
          :cwd="cwd"
          :agent="agent"
          :custom-agent="customAgentId"
          :launch="launchChoice"
          :hide-header="filmstrip"
          :expanded="expanded"
          :zoomed="zoomed"
          dev-terminal
          run-menu
          @session="onSession"
          @input="onTerminalInput"
          @cwd="onServerCwd"
          @run="(cmd) => emit('runSpare', cmd)"
          @canvas="emit('canvas')"
        >
          <!-- Row 2 — actions on the SESSION, gathered onto the terminal's header row beside the
             ones Terminal.vue puts there itself (Run, Skills, the configured header buttons,
             voice). Anything that acts on the cell rather than on what is running inside it
             belongs on row 1 with expand/close. -->
          <!-- Row 2's LEAD — where this cell IS, and everything you might want to do with that
             place. It replaces four always-visible icons (`reveal` / `files` / `terminal` / `gh`,
             ex-DEFAULT_BUTTONS) and the GitHub button that stood beside them: all of them answered
             "do something with this directory", the question the path itself asks, and `reveal` was
             literally the path's own click. Occasional navigations do not each deserve a permanent
             icon in a tiled cell. Reveal stays first so the one gesture that already existed —
             click the path, get the folder — is still the shortest. -->
          <template #header-lead>
            <!-- Escape is bound on the WRAPPER, not on the menu. Opening the menu leaves focus on
               the trigger button, so a handler on the menu itself only fires if something inside it
               happens to be focused — which, in the ordinary flow of clicking the path and changing
               your mind, is nothing. Keydown bubbles from the trigger to here, so this closes it
               from wherever focus actually is. Focus returns to the trigger afterwards, or Escape
               would strand the keyboard on a button that no longer exists. -->
            <span ref="pathWrap" class="relative flex min-w-0 flex-auto items-center" @keydown.escape="closePathMenu">
              <button
                v-if="headerDir"
                ref="pathTrigger"
                type="button"
                data-testid="cell-dir"
                class="cell-dir flex min-w-0 cursor-pointer items-center gap-0.5 border-none bg-transparent p-0 font-mono text-[11px] text-[var(--cell-header-fg,var(--text-dim))] hover:text-muted"
                :title="cwd ?? ''"
                aria-haspopup="true"
                :aria-expanded="pathMenuOpen"
                @click="pathMenuOpen = !pathMenuOpen"
              >
                <span class="min-w-0" :class="DIR_TRUNCATE_FRONT"
                  ><span class="cell-dir-path" :class="CELL_DIR_PATH">{{ headerDir }}</span></span
                >
                <!-- The path never showed that it was pressable — it opened a folder on click with
                   nothing but a hover underline to say so. Now that a click costs a menu, the
                   caret has to be there. -->
                <span class="material-symbols-outlined flex-none text-[14px]" aria-hidden="true">arrow_drop_down</span>
              </button>
              <div
                v-if="pathMenuOpen"
                data-testid="cell-path-menu"
                class="absolute left-0 top-full z-20 mt-1 flex min-w-[190px] flex-col rounded-md border border-border bg-panel p-1 shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
              >
                <button type="button" data-testid="cell-path-item" :class="PATH_MENU_ITEM" @click="pathMenuAction(openDir)">
                  <span class="material-symbols-outlined text-[15px]" aria-hidden="true">folder</span> Reveal in the file manager
                </button>
                <button type="button" data-testid="cell-path-item" :class="PATH_MENU_ITEM" @click="pathMenuAction(browseFiles)">
                  <span class="material-symbols-outlined text-[15px]" aria-hidden="true">folder_open</span> Browse files in the app
                </button>
                <button type="button" data-testid="cell-path-item" :class="PATH_MENU_ITEM" @click="pathMenuAction(newTerminalHere)">
                  <span class="material-symbols-outlined text-[15px]" aria-hidden="true">terminal</span> New terminal here
                </button>
                <!-- GitHub only when the remote resolves to one — the same gate the button it
                   replaced had, so this never offers a broken link. -->
                <template v-if="githubUrl">
                  <span class="my-1 h-px flex-none bg-border" aria-hidden="true" />
                  <button type="button" data-testid="cell-path-item" :class="PATH_MENU_ITEM" @click="pathMenuAction(() => openGithub(''))">
                    <span class="material-symbols-outlined text-[15px]" aria-hidden="true">public</span> Repository
                  </button>
                  <button type="button" data-testid="cell-path-item" :class="PATH_MENU_ITEM" @click="pathMenuAction(() => openGithub('/issues'))">
                    <span class="material-symbols-outlined text-[15px]" aria-hidden="true">error</span> Issues
                  </button>
                  <button type="button" data-testid="cell-path-item" :class="PATH_MENU_ITEM" @click="pathMenuAction(() => openGithub('/pulls'))">
                    <span class="material-symbols-outlined text-[15px]" aria-hidden="true">merge</span> Pull requests
                  </button>
                </template>
              </div>
            </span>
          </template>
          <template #header-actions>
            <span v-if="sessionId" ref="askWrap" class="relative inline-flex flex-none">
              <button
                type="button"
                data-testid="cell-ask"
                class="cell-btn"
                :class="CELL_BTN"
                title="Bring another terminal's last turn into this input box"
                aria-label="Bring another terminal's last turn here"
                aria-haspopup="true"
                :aria-expanded="askMenuOpen"
                @click="openAskMenu"
              >
                <span class="material-symbols-outlined" aria-hidden="true">forum</span>
              </button>
              <!-- Bounded and scrollable, like every other dropdown here (MulmoMenu / RunMenu /
                   SkillMenu). This one was the exception, and it holds TWO lists that grow with the
                   grid — one row per other terminal here, and one seat per terminal in the round
                   table below — so at 20 cells it stood 1750px tall with nothing scrollable, and
                   Start sat a thousand pixels below the window (#2003).
                   The lists inside do the scrolling, so the controls under them (turns, room,
                   Start) stay put instead of scrolling away with the rows they act on. The
                   container scrolls too — `overflow-y-auto`, not `overflow-hidden` — because the
                   controls are `flex-none` and a short enough menu cannot shrink to hold them:
                   with `hidden` they were CLIPPED, which is the reported bug again at any height
                   under ~250px. Scrolling is the graceful failure; clipping is the original one. -->
              <div
                v-if="askMenuOpen"
                data-testid="cell-ask-menu"
                class="absolute right-0 z-20 flex min-w-[180px] flex-col overflow-y-auto rounded-md border border-border bg-panel p-1 shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
                :class="askMenuUp ? 'bottom-full mb-1' : 'top-full mt-1'"
                :style="askMenuMaxH === null ? undefined : { maxHeight: `${askMenuMaxH}px` }"
                @keydown.escape="askMenuOpen = false"
              >
                <!-- A floor of about one row, not `min-h-0`: a flex child that may shrink below its
                     content will shrink to ZERO in a short menu, and a list with no height is a list
                     nobody can click. Shrinking is still what gives the max-height its room — this
                     only stops it going all the way. -->
                <div data-testid="cell-ask-list" class="flex min-h-[2.5rem] flex-col overflow-y-auto">
                  <div v-for="target in askTargets" :key="target.key" class="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid="cell-ask-item"
                      class="flex-1"
                      :class="CELL_MENU_ITEM"
                      :title="`Bring ${target.label}'s last turn here`"
                      @click="askCell(target)"
                    >
                      {{ target.label }}
                    </button>
                    <button
                      type="button"
                      data-testid="cell-exchange-item"
                      :aria-label="`Exchange one turn with ${target.label}`"
                      class="cursor-pointer rounded-[4px] border-none bg-transparent px-1.5 py-1.5 font-sans text-[12px] text-dim hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40"
                      :disabled="automating"
                      title="Send this cell's turn there and bring the answer back, both submitted"
                      @click="exchangeWith(target)"
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span>
                    </button>
                  </div>
                </div>
                <p v-if="!askTargets.length" class="m-0 px-2 py-1.5 font-sans text-[12px] text-dim">No other terminal to read</p>
                <RoundTableMenu
                  v-if="askTargets.length"
                  :targets="askTargets"
                  :self-label="`#${uid}`"
                  :running="tableRunning"
                  :room="tableRoom"
                  :busy="automating"
                  @start="startTable"
                  @stop="stopTable"
                />
              </div>
              <button
                v-if="exchanging"
                type="button"
                data-testid="cell-exchange-stop"
                aria-label="Stop the exchange in progress"
                class="absolute right-0 top-full z-20 mt-1 cursor-pointer whitespace-nowrap rounded-md border border-border bg-panel px-2 py-1.5 font-sans text-[12px] text-secondary shadow-[0_6px_18px_rgba(0,0,0,0.35)] hover:text-fg"
                @click="stopExchange"
              >
                <span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span> exchanging — stop
              </button>
              <p
                v-else-if="askMsg"
                data-testid="cell-ask-msg"
                role="status"
                class="absolute right-0 top-full z-20 m-0 mt-1 whitespace-nowrap rounded-md border border-border bg-panel px-2 py-1.5 font-sans text-[12px] text-dim shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
              >
                {{ askMsg }}
              </p>
            </span>
            <CopyCodeBlock v-if="sessionId" :class="CELL_BTN" :session-id="sessionId" :cwd="cwd" :agent="agent" />
            <button
              v-if="sessionId && agent === 'claude'"
              class="cell-btn"
              :class="CELL_BTN"
              title="Activity timeline"
              aria-label="Show activity timeline"
              @click="timelineOpen = true"
            >
              <span class="material-symbols-outlined" aria-hidden="true">history</span>
            </button>
          </template>
        </TerminalView>
        <div
          v-if="diffOpen && diff"
          data-testid="cell-diff"
          class="absolute inset-x-0 bottom-0 top-[34px] z-[15] flex flex-col overflow-hidden border-t border-t-border bg-base"
        >
          <div class="flex flex-none items-center gap-2 border-b border-b-border bg-panel px-2 py-1.5">
            <span class="font-sans text-[12px] font-semibold text-fg">Changes vs {{ diff?.base ?? "base" }}</span>
            <span class="flex-auto font-sans text-[11px] text-dim">{{ diff?.ahead ?? 0 }} ahead · {{ diff?.dirty ?? 0 }} uncommitted</span>
            <button class="cell-btn" :class="CELL_BTN" title="Close diff" aria-label="Close diff" @click="diffOpen = false">
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
          <div v-if="diff && diff.files.length" class="max-h-[35%] flex-none overflow-y-auto border-b border-b-border px-2 py-1">
            <div v-for="f in diff.files" :key="f.path" data-testid="cell-diff-file" class="flex items-baseline gap-2 py-px font-mono text-[11px]">
              <span class="min-w-0 flex-auto text-secondary" :class="DIR_TRUNCATE_FRONT"
                ><span :class="CELL_DIR_PATH">{{ f.path }}</span></span
              >
              <span v-if="f.status === 'untracked'" data-testid="df-new" class="flex-none text-[#3fae6b]">new</span>
              <span v-else class="flex-none">
                <span class="text-[#3fae6b]">+{{ f.additions < 0 ? "bin" : f.additions }}</span>
                <span class="text-err-text">−{{ f.deletions < 0 ? "bin" : f.deletions }}</span>
              </span>
            </div>
          </div>
          <pre
            v-if="diff && diff.patch"
            data-testid="cell-diff-patch"
            class="m-0 flex-auto overflow-auto whitespace-pre p-2 font-mono text-[11px] leading-[1.45] text-secondary [tab-size:2]"
            >{{ diff.patch }}</pre>
          <p v-if="diff && diff.truncated" class="m-0 p-2 font-sans text-[11px] text-dim">Diff truncated — open the worktree to see the rest.</p>
          <p v-if="diff && !diff.files.length" class="m-0 p-2 font-sans text-[11px] text-dim">No changes yet.</p>
          <div class="flex flex-none items-center gap-2 border-t border-t-border bg-panel px-2 py-1.5">
            <button
              data-testid="cell-diff-btn"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-elevated px-3 py-1 font-sans text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="prBusy || working || (diff?.dirty ?? 0) === 0"
              :title="(diff?.dirty ?? 0) === 0 ? 'No uncommitted changes' : working ? 'Wait for the session to finish' : 'Ask Claude to commit the changes'"
              @click="commitViaClaude"
            >
              <span class="material-symbols-outlined" aria-hidden="true">check</span> Commit
            </button>
            <button
              data-testid="cell-diff-btn"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-elevated px-3 py-1 font-sans text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="prBusy || (diff?.ahead ?? 0) === 0"
              :title="(diff?.ahead ?? 0) === 0 ? 'Commit changes first' : 'git push -u origin'"
              @click="pushBranch"
            >
              <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span> Push
            </button>
            <button
              data-testid="cell-diff-btn"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-elevated px-3 py-1 font-sans text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="prBusy || (diff?.ahead ?? 0) === 0"
              :title="(diff?.ahead ?? 0) === 0 ? 'Commit changes in the terminal first' : 'Push and open a pull request'"
              @click="openPR"
            >
              <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span> Open PR
            </button>
            <span v-if="prMsg" data-testid="cell-diff-msg" class="min-w-0 flex-auto truncate font-sans text-[11px] text-dim">{{ prMsg }}</span>
          </div>
        </div>
        <!-- Replaced, not faded, while the removal runs: every control in here is already disabled
             by then, and a dialog of dead buttons is noise where the spinner above is an answer. It
             comes BACK with the failure if the removal fails — which is what the dismissal guards
             below exist to protect (#1550). -->
        <div
          v-if="closeConfirm && !removingWorktree"
          data-testid="cell-close-confirm"
          class="absolute inset-0 z-[25] flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-base)_82%,transparent)] p-4"
          role="dialog"
          aria-modal="true"
          :aria-label="`Close worktree ${headerDir}`"
        >
          <div class="flex max-w-[320px] flex-col gap-2.5 rounded-lg border border-border bg-panel p-4 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <p class="m-0 font-sans text-[13px] font-semibold text-fg">Close {{ headerDir }}</p>
            <template v-if="!closeError">
              <p v-if="hasUnsaved" data-testid="ccx-warn" class="m-0 font-sans text-[12px] text-[var(--warn-text,#e0a030)]">
                {{ unsavedSummary }} will be discarded if you remove the worktree.
              </p>
              <p v-else class="m-0 font-sans text-[12px] text-dim">Keep the worktree to reuse it later, or remove it.</p>
              <div class="flex flex-wrap gap-1.5">
                <!-- Held during a removal: by then the pty is gone and the branch is being
                     deleted, so "keep" is a promise this cannot make. -->
                <button
                  data-testid="ccx-keep"
                  class="cursor-pointer rounded-md border border-accent bg-elevated px-3 py-1.5 font-sans text-[12px] text-fg enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
                  :disabled="closeBusy !== null"
                  @click="teardown"
                >
                  Keep worktree
                </button>
                <button
                  data-testid="ccx-remove"
                  class="cursor-pointer rounded-md border border-border bg-elevated px-3 py-1.5 font-sans text-[12px] text-secondary enabled:hover:border-err-text enabled:hover:bg-[var(--err-hover-bg)] enabled:hover:text-err-text disabled:cursor-default disabled:opacity-40"
                  :disabled="closeChecking || closeBusy !== null"
                  @click="removeAndClose"
                >
                  {{ removeButtonLabel }}
                </button>
                <button
                  data-testid="ccx-cancel"
                  class="cursor-pointer rounded-md border border-border bg-elevated px-3 py-1.5 font-sans text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
                  :disabled="closeBusy !== null"
                  @click="cancelClose"
                >
                  Cancel
                </button>
              </div>
            </template>
            <template v-else>
              <p data-testid="ccx-warn" class="m-0 font-sans text-[12px] text-[var(--warn-text,#e0a030)]">{{ closeError }}</p>
              <div class="flex flex-wrap gap-1.5">
                <button
                  data-testid="ccx-remove"
                  class="cursor-pointer rounded-md border border-border bg-elevated px-3 py-1.5 font-sans text-[12px] text-secondary enabled:hover:border-err-text enabled:hover:bg-[var(--err-hover-bg)] enabled:hover:text-err-text disabled:cursor-default disabled:opacity-40"
                  :disabled="closeBusy !== null"
                  @click="removeAndClose"
                >
                  {{ closeBusy === REMOVE_KEY ? "Removing…" : "Retry" }}
                </button>
                <button
                  data-testid="ccx-close-cell"
                  class="cursor-pointer rounded-md border border-border bg-elevated px-3 py-1.5 font-sans text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
                  :disabled="closeBusy !== null"
                  @click="teardown"
                >
                  Close cell
                </button>
              </div>
            </template>
          </div>
        </div>
      </template>
      <CellLaunchForm
        v-else
        :dir="dirInput"
        :agent="pickedAgent"
        :choice="launchChoice"
        :default-cwd="defaultCwd"
        :presets="presets"
        :config-unavailable="configUnavailable === true"
        :launchers="launchers"
        :custom-agents="customAgents ?? []"
        :open-session-ids="openSessionIds"
        :open-cwds="openCwds"
        @update:dir="onLaunchDir"
        @update:agent="(value) => (pickedAgent = value)"
        @update:choice="(value) => (launchChoice = value)"
        @start="startPickedAgent"
        @resume="resumeSession"
        @run="(cmd) => emit('run', cmd)"
        @launch="(pick) => emit('launch', pick)"
        @remove-preset="(path) => emit('remove-preset', path)"
        @retry-config="emit('retry-config')"
        @close="emit('close')"
      />
    </div>
  </div>
</template>
