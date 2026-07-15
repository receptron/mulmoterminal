<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from "vue";
import TerminalView from "./Terminal.vue";
import { usePubSub } from "../composables/usePubSub";
import { useDirConfig } from "../composables/useDirConfig";
import { useGitStatus } from "../composables/useGitStatus";
import { formatCwd, worktreeLabel } from "./cwdDisplay";
import { badgeStyleFor } from "./dirBadge";
import { headerStyleFor, cellStyleFor } from "./cellHeaderStyle";
import GitBranchChip from "./GitBranchChip.vue";
import ModelContextBadge from "./ModelContextBadge.vue";
import type { RunCommand } from "./runCommand";
import { useHeaderButtons } from "../composables/useHeaderButtons";
import TimelineOverlay from "./TimelineOverlay.vue";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";
import { activityStatus, type CellStatus } from "./gridTabs";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";

const termRef = useTemplateRef<InstanceType<typeof TerminalView>>("termRef");

// Clicking the header background zooms this cell ONLY when it's a filmstrip thumbnail
// (another cell is zoomed) — the easy "switch to this terminal" gesture. In the normal
// grid the header is inert; the ⤢ button is the only way to zoom. Header buttons keep
// their action.
function onHeaderClick(event: MouseEvent) {
  if (shouldZoomOnHeaderClick(event.target, filmstrip.value)) emit("toggle-expand");
}

// `expanded` reflects whether this cell is zoomed to fill the grid (parent owns
// the state). `initialSessionId` resumes a session on mount (reload restore).
// `initialCwd` is this cell's persisted working dir; `defaultCwd` is the server
// default used to prefill the launch form; `presets` are quick-pick dirs; `home`
// is the server home dir (to anchor the header path on ~).
const props = defineProps<{
  // The grid cell's stable uid — the durable-connection slot key for this cell's
  // terminal, so flipping to an off-page tab detaches the view without reaping the PTY.
  uid: number;
  expanded: boolean;
  // True while SOME cell in the grid is zoomed. A non-expanded cell then renders as a
  // small filmstrip thumbnail, so it drops to a minimal header (dir + activity + zoom).
  zoomed?: boolean;
  initialSessionId: string | null;
  initialCwd: string | null;
  // The persisted agent for this cell: "codex" reconnects via /ws/codex on reload; absent
  // (or "claude") resumes as a normal Claude session.
  initialAgent?: "codex" | null;
  defaultCwd: string | null;
  presets: CwdPreset[];
  // Configured launch commands (shell/codex/…) offered next to Claude in this launcher.
  launchers?: Launcher[];
  home: string | null;
  // Session ids open in other grid cells. Resuming one of them would detach that
  // cell, so the launcher flags such rows and confirms before opening.
  openSessionIds?: string[];
  // Dirs with a running session in another cell, so the launcher can tint preset
  // chips whose dir is already in use.
  openCwds?: string[];
  // An added (not the sole entry) launcher: show a ✕ to dismiss it before launching.
  cancellable?: boolean;
  // Manual sort mode: show ◀▶ to swap this cell with its neighbour.
  reorderable?: boolean;
}>();
const emit = defineEmits<{
  (e: "toggle-expand" | "close"): void;
  // `record-cwd`: auto-record a fresh launch's server-confirmed cwd as a preset.
  // `remove-preset`: drop a preset (its ✕) from the shared list — value is the path.
  (e: "session" | "cwd" | "record-cwd" | "remove-preset", value: string): void;
  // `run` launches in THIS (empty) cell from the launcher; `runSpare` is the running
  // terminal's header menu, which must NOT replace the session — it runs in a new cell.
  (e: "run" | "runSpare", value: RunCommand): void;
  // The user picked a configured launcher (shell/codex/…) to run in this empty cell.
  (e: "launch", value: LaunchPick): void;
  // Swap this cell left (-1) or right (+1) in manual sort mode.
  (e: "move", dir: -1 | 1): void;
  // Report live activity up so the grid can attention-sort in auto mode.
  (e: "status", value: CellStatus): void;
  // The agent chosen (Claude/Codex) for this fresh launch, so the grid persists it.
  (e: "agent", value: "claude" | "codex"): void;
}>();

// A cell with a persisted session relaunches (resumes) on mount; otherwise it
// starts empty and lazy-launches when the user picks a dir and clicks Start.
const launched = ref(props.initialSessionId !== null);
const sessionId = ref<string | null>(props.initialSessionId);
// The agent this cell runs (Claude by default). Fixed once launched; restored from the
// persisted cell on reload so a codex cell reconnects to /ws/codex.
const agent = ref<"claude" | "codex">(props.initialAgent === "codex" ? "codex" : "claude");
const connectKey = ref(0);

// The directory this terminal runs in (shown in the header, sent to the server).
const cwd = ref<string | null>(props.initialCwd ?? props.defaultCwd);
// Per-directory overrides (<cwd>/.mulmoterminal.json): pins this cell's terminal
// palette and shows a project badge. Re-fetched when the effective cwd changes.
const { config: dirConfig } = useDirConfig(cwd);
const dirBadgeStyle = computed(() => badgeStyleFor(dirConfig.value.badgeColor));
const headerStyle = computed(() => headerStyleFor(dirConfig.value.headerColor, dirConfig.value.headerTextColor));
const cellStyle = computed(() =>
  cellStyleFor(dirConfig.value.cellColor, dirConfig.value.cellBorderColor, dirConfig.value.dotColor, dirConfig.value.buttonColor),
);
// Live git status (branch/dirty/ahead·behind) for the header chip. `refreshGit`
// is called alongside loadDiff() so a finished turn's changes show immediately.
const { status: gitStatus, refresh: refreshGit } = useGitStatus(cwd);
// Activity timeline overlay (the header 🕘) — only meaningful for a Claude session.
const timelineOpen = ref(false);
// A small filmstrip thumbnail (some OTHER cell is zoomed): strip the header to just
// dir + what it's doing + a zoom button, and hide the second (terminal) header row.
const filmstrip = computed(() => !!props.zoomed && !props.expanded);
// The launch form's editable dir. Prefer this cell's persisted dir, then the most
// recent preset, then the server default. Both `presets` and `defaultCwd` arrive
// async from /api/config, so the watcher upgrades a still-pristine field once they
// load (cold-load / open-before-config) — it never clobbers the user's own edit.
const dirInput = ref(props.initialCwd ?? props.presets[0]?.path ?? props.defaultCwd ?? "");
const dirTouched = ref(false); // true once the user types in / picks a dir
watch([() => props.presets, () => props.defaultCwd], () => {
  if (cwd.value === null && props.defaultCwd) cwd.value = props.defaultCwd;
  if (props.initialCwd || dirTouched.value || launched.value) return;
  const preferred = props.presets[0]?.path ?? props.defaultCwd;
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

// Cumulative token usage for this session (from /api/session/:id, refreshed when a
// turn finishes). Null until first fetched.
interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
const usage = ref<Usage | null>(null);
const isUsage = (u: unknown): u is Usage => typeof u === "object" && u !== null && "outputTokens" in u;

// The running model + current-turn context size (from /api/session/:id), for the
// model/context badge. Null until first fetched; model may be null with no assistant
// turn yet, which hides the badge.
interface SessionContext {
  model: string | null;
  contextTokens: number;
}
const context = ref<SessionContext | null>(null);
const isContext = (c: unknown): c is SessionContext => typeof c === "object" && c !== null && "contextTokens" in c;

// Configurable row-1 info chips (GET /api/header `chips`). `null` = unconfigured ⇒ the default order/set
// below, so with no config the header is exactly as before. When configured, the built-ins listed here
// (git/diff/ctx/usage) render in that order — others are hidden — and custom chips render as text. `dir`,
// the project badge, the status dot/activity, and the row-2 tools timeline stay structural.
const { chips: headerChips } = useHeaderButtons({ cwd, session: sessionId, agent, model: computed(() => context.value?.model ?? null) });
const ROW1_BUILTIN_CHIPS = new Set(["git", "diff", "ctx", "usage"]);
const DEFAULT_CELL_CHIP_IDS = ["git", "diff", "ctx", "usage"];
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

const { subscribe } = usePubSub();
let unsubscribe: (() => void) | null = null;

interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
  lastPrompt?: string | null;
  aiTitle?: string | null;
}
const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

function applyActivity(d: ActivityMsg) {
  working.value = d.working ?? false;
  waiting.value = d.waiting ?? false;
  if (d.event !== undefined) activityEvent.value = d.event;
  // Apply lastPrompt/aiTitle whenever the field is present — including an explicit null,
  // so a cleared/new session doesn't keep showing the previous prompt or title.
  if (d.lastPrompt !== undefined) lastPrompt.value = d.lastPrompt;
  if (d.aiTitle !== undefined) aiTitle.value = d.aiTitle;
}

async function loadInitial(id: string) {
  try {
    // Pass the cell's dir so the server can read the transcript and report the
    // session's most recent prompt (not just the bare id) after a resume.
    const q = cwd.value ? `?cwd=${encodeURIComponent(cwd.value)}` : "";
    const res = await fetch(`/api/session/${id}${q}`);
    if (!res.ok) return;
    const data = await res.json();
    // Guard against a stale response: the cell may have closed / switched session
    // while the fetch was in flight — don't leak old status into the new state.
    if (id === sessionId.value) {
      applyActivity(data);
      if (isUsage(data.usage)) usage.value = data.usage;
      if (isContext(data.context)) context.value = data.context;
    }
  } catch {
    // best-effort — pub/sub will fill it in on the next event
  }
}

// Refresh ONLY the token usage (not the live activity — that's pub/sub's job). Called
// when a turn finishes, so the badge reflects the just-completed turn.
async function refreshUsage() {
  const id = sessionId.value;
  if (!id) return;
  try {
    const q = cwd.value ? `?cwd=${encodeURIComponent(cwd.value)}` : "";
    const res = await fetch(`/api/session/${id}${q}`);
    if (!res.ok) return;
    const data = await res.json();
    if (id !== sessionId.value) return;
    if (isUsage(data.usage)) usage.value = data.usage;
    if (isContext(data.context)) context.value = data.context;
  } catch {
    // best-effort
  }
}

onMounted(() => {
  unsubscribe = subscribe("sessions", (d) => {
    if (isActivityMsg(d) && d.id === sessionId.value) applyActivity(d);
  });
  if (sessionId.value) {
    loadInitial(sessionId.value);
    loadDiff(); // a resumed worktree cell shows its diff on restore
  } else {
    loadResumable();
    loadScripts();
    loadWorktrees();
  }
});
onUnmounted(() => {
  unsubscribe?.();
  if (resumableTimer) clearTimeout(resumableTimer);
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
  emit("agent", agent.value); // let the grid persist which agent this cell launched
  recordNextCwd = true;
  loadDiff(); // no-op for a non-worktree dir
}
function launch() {
  launchIn(dirInput.value.trim() || props.defaultCwd);
}

// Launch a configured program (shell/codex/…) in this cell's chosen dir. The parent
// turns the empty cell into a persistent launcher cell (index is the server allowlist
// position); this cell is then replaced by a LauncherCell.
function launchProgram(index: number, l: Launcher) {
  emit("launch", { index, label: l.label, cwd: dirInput.value.trim() || props.defaultCwd });
}

// The chip's ▶ button: a one-click quick launch — fill the field and jump straight
// into a fresh session in that dir.
function selectPreset(p: CwdPreset) {
  dirInput.value = p.path;
  launchIn(p.path);
}

// A programmatic dir change (fillDir) loads the lists immediately, so the dirInput watch
// below must skip the debounced reload it would otherwise ALSO fire — or every preset
// click / folder pick would fetch the lists twice.
let skipDirWatch = false;

// The chip's main click (and the 📁 folder picker): fill the field WITHOUT launching,
// and refresh the resume / script / worktree lists for that dir so the user can pick a
// session to resume — or start fresh — instead of launching immediately.
function fillDir(path: string) {
  dirTouched.value = true;
  // Set the skip only when the value actually changes (so the watch will fire and consume
  // it) — a same-value click doesn't fire the watch and would leave a stale flag that
  // swallows the next real reload.
  if (dirInput.value !== path) skipDirWatch = true;
  dirInput.value = path;
  loadResumable();
  loadScripts();
  loadWorktrees();
}

// The 📁 button: the browser can't open a native folder chooser, so the local server does
// (POST /api/pick-file { directory: true }). Fill the Working-directory field with the pick.
async function pickDir() {
  try {
    const res = await fetch("/api/pick-file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directory: true }) });
    if (!res.ok) return;
    const data = await res.json();
    const dir = Array.isArray(data?.paths) ? data.paths.find((p: unknown): p is string => typeof p === "string") : undefined;
    if (dir) fillDir(dir);
  } catch {
    // best-effort — the native dialog is unavailable or the user canceled
  }
}

// Existing sessions for the dir in the form, so an empty cell can resume one
// instead of starting fresh.
interface ResumableSession {
  id: string;
  title: string;
  mtime: number;
}
const resumable = ref<ResumableSession[]>([]);
// The resolved cwd the listed sessions belong to (the server may resolve/fallback
// the requested dir). resume() uses THIS — not the live input — so the session id
// and cwd always match the row that was clicked.
const resumableCwd = ref<string | null>(null);
let resumableTimer: ReturnType<typeof setTimeout> | null = null;
let resumableReq = 0; // request token: drop out-of-order responses

async function loadResumable() {
  const dir = dirInput.value.trim() || props.defaultCwd;
  const reqId = ++resumableReq;
  if (launched.value || !dir) {
    resumable.value = [];
    resumableCwd.value = null;
    return;
  }
  try {
    const res = await fetch(`/api/sessions?cwd=${encodeURIComponent(dir)}`);
    if (reqId !== resumableReq) return; // a newer request superseded this one
    const data = res.ok ? await res.json() : { sessions: [], cwd: dir };
    if (reqId !== resumableReq) return; // re-check after awaiting the body
    resumable.value = data.sessions ?? [];
    resumableCwd.value = data.cwd ?? dir;
  } catch {
    if (reqId === resumableReq) {
      resumable.value = [];
      resumableCwd.value = null;
    }
  }
}

// The runnable scripts (script.json) for the dir in the form, so an empty cell can
// run one in that directory instead of starting a Claude session.
interface RunnableScript {
  index: number;
  label: string;
  command: string;
  cwd?: string;
}
const scripts = ref<RunnableScript[]>([]);
// The resolved cwd the listed scripts belong to (the server may resolve/fallback the
// requested dir). runScript() uses THIS so the command runs in the dir the list was
// fetched for.
const scriptsCwd = ref<string | null>(null);
let scriptsReq = 0; // request token: drop out-of-order responses

async function loadScripts() {
  const dir = dirInput.value.trim() || props.defaultCwd;
  const reqId = ++scriptsReq;
  if (launched.value || !dir) {
    scripts.value = [];
    scriptsCwd.value = null;
    return;
  }
  try {
    const res = await fetch(`/api/scripts?cwd=${encodeURIComponent(dir)}`);
    if (reqId !== scriptsReq) return;
    const data = res.ok ? await res.json() : { scripts: [], cwd: dir };
    if (reqId !== scriptsReq) return;
    scripts.value = Array.isArray(data.scripts) ? data.scripts : [];
    scriptsCwd.value = data.cwd ?? dir;
  } catch {
    if (reqId === scriptsReq) {
      scripts.value = [];
      scriptsCwd.value = null;
    }
  }
}

function runScript(s: RunnableScript) {
  emit("run", { source: "script", index: s.index, label: s.label, cwd: scriptsCwd.value ?? (dirInput.value.trim() || props.defaultCwd) });
}

// Per-agent isolation: when the dir is a git repo, the launcher can start claude in
// its own throwaway worktree (separate working tree, shared .git) so several agents
// work the repo without clobbering each other. Managed by the server (/api/worktrees).
interface Worktree {
  path: string;
  branch: string | null;
  task: string;
  dirty: boolean;
}
const isGitRepo = ref(false);
const worktrees = ref<Worktree[]>([]);
const worktreeTask = ref("");
let worktreesReq = 0;

async function loadWorktrees() {
  const dir = dirInput.value.trim() || props.defaultCwd;
  const reqId = ++worktreesReq;
  if (launched.value || !dir) {
    isGitRepo.value = false;
    worktrees.value = [];
    return;
  }
  try {
    const res = await fetch(`/api/worktrees?cwd=${encodeURIComponent(dir)}`);
    if (reqId !== worktreesReq) return;
    const data = res.ok ? await res.json() : { isGit: false, worktrees: [] };
    if (reqId !== worktreesReq) return;
    isGitRepo.value = !!data.isGit;
    worktrees.value = Array.isArray(data.worktrees) ? data.worktrees : [];
  } catch {
    if (reqId === worktreesReq) {
      isGitRepo.value = false;
      worktrees.value = [];
    }
  }
}

// Create a fresh worktree for the typed task and launch claude in it.
async function createWorktreeAndLaunch() {
  const repoDir = dirInput.value.trim() || props.defaultCwd;
  const task = worktreeTask.value.trim();
  if (!repoDir || !task) return;
  try {
    const res = await fetch("/api/worktrees/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoDir, task }),
    });
    if (!res.ok) return;
    const wt = await res.json();
    if (typeof wt.path === "string") {
      worktreeTask.value = "";
      launchIn(wt.path);
    }
  } catch {
    // best-effort — the launcher stays open so the user can retry
  }
}

const reuseWorktree = (w: Worktree) => launchIn(w.path);

// Remove a managed worktree (＋ its branch). A dirty one is confirmed first so work
// is never discarded silently.
async function removeWorktree(w: Worktree) {
  const repoDir = dirInput.value.trim() || props.defaultCwd;
  if (w.dirty && !window.confirm(`"${w.task}" has uncommitted changes. Discard and remove it?`)) return;
  try {
    await fetch("/api/worktrees/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoDir, path: w.path, deleteBranch: true, force: w.dirty }),
    });
    loadWorktrees();
  } catch {
    // best-effort
  }
}

// Refresh the resume list and the runnable scripts when the target dir changes.
watch([dirInput, () => props.defaultCwd], () => {
  // Cancel any pending debounced reload FIRST — whether we skip (a fillDir just loaded
  // immediately) or reschedule (typing), a stale timer from a prior change (e.g. a type
  // then a preset click) must not fire a duplicate load afterwards.
  if (resumableTimer) clearTimeout(resumableTimer);
  if (skipDirWatch) {
    skipDirWatch = false; // a fillDir() already loaded these immediately — don't schedule another
    return;
  }
  resumableTimer = setTimeout(() => {
    loadResumable();
    loadScripts();
    loadWorktrees();
  }, 300);
});

// A session already live in another grid cell. Resuming it here detaches that
// cell (the server supersedes the prior socket), so we warn before doing so.
const sessionOpenElsewhere = (id: string): boolean => id !== sessionId.value && (props.openSessionIds ?? []).includes(id);

// A preset dir that already has a running session in another cell — the launcher
// tints its chip so the user can tell it's in use before double-launching there.
const runningCwds = computed(() => new Set(props.openCwds ?? []));
const isCwdRunning = (path: string): boolean => runningCwds.value.has(path);

function resume(s: ResumableSession) {
  if (sessionOpenElsewhere(s.id) && !window.confirm(`"${s.title}" is already open in another terminal. Opening it here will detach that one. Continue?`))
    return;
  // Use the cwd those rows were fetched for, not the (possibly-changed) input.
  cwd.value = resumableCwd.value ?? (dirInput.value.trim() || props.defaultCwd);
  sessionId.value = s.id;
  connectKey.value++;
  launched.value = true;
  recordNextCwd = false; // resuming isn't a fresh launch — don't record its cwd
  loadDiff(); // an already-idle worktree session shows its badge right away
}

function relativeTime(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// Reveal this cell's working directory in the OS file manager. The browser can't
// open a folder, but the local server can (POST /api/open-dir).
async function openDir() {
  if (!cwd.value) return;
  try {
    await fetch("/api/open-dir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: cwd.value }),
    });
  } catch {
    // best-effort — opening a folder is non-critical
  }
}

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
const ghMenuOpen = ref(false);
const ghWrap = useTemplateRef<HTMLElement>("ghWrap");
let githubReq = 0; // request token: drop out-of-order responses (cwd can change fast)

async function refreshGithubUrl() {
  ghMenuOpen.value = false;
  const reqId = ++githubReq;
  if (!cwd.value) {
    githubUrl.value = null;
    return;
  }
  try {
    const res = await fetch("/api/git-remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: cwd.value }),
    });
    if (reqId !== githubReq) return; // a newer cwd superseded this lookup
    const data = res.ok ? await res.json() : null;
    if (reqId !== githubReq) return; // re-check after awaiting the body
    githubUrl.value = data && typeof data.githubUrl === "string" ? data.githubUrl : null;
  } catch {
    if (reqId === githubReq) githubUrl.value = null; // best-effort — the link just won't appear
  }
}
watch(cwd, refreshGithubUrl, { immediate: true });

// Repository top page (""), Issues, or Pull requests — opened in a new tab.
function openGithub(suffix: string) {
  if (!githubUrl.value) return;
  window.open(githubUrl.value + suffix, "_blank", "noopener,noreferrer");
  ghMenuOpen.value = false;
}

function onGhOutside(e: MouseEvent) {
  if (ghWrap.value && !ghWrap.value.contains(e.target as Node)) ghMenuOpen.value = false;
}
watch(ghMenuOpen, (open) => {
  if (open) document.addEventListener("mousedown", onGhOutside);
  else document.removeEventListener("mousedown", onGhOutside);
});
onUnmounted(() => document.removeEventListener("mousedown", onGhOutside));

// Reap the session and reset the cell back to the empty launcher. The cell isn't
// remounted (stable key), so the dir/diff state is reset explicitly — otherwise the
// launch form would still show the closed session's directory.
function teardown() {
  const id = sessionId.value; // capture before the reset below nulls it
  termRef.value?.terminate();
  // Reap on the server over HTTP too — the WS `terminate` only reaches the server while
  // the socket is open, so a disconnected cell's ✕ would otherwise leave its tmux alive.
  if (id) fetch(`/api/session/${encodeURIComponent(id)}/terminate`, { method: "POST" }).catch(() => {});
  launched.value = false;
  recordNextCwd = false; // drop any pending fresh-launch record from a torn-down session
  sessionId.value = null;
  working.value = false;
  waiting.value = false;
  activityEvent.value = null;
  lastPrompt.value = null;
  aiTitle.value = null;
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
  loadResumable();
  loadScripts();
  loadWorktrees();
}

// Closing a WORKTREE cell offers to keep or remove the room first (never silently
// discards uncommitted/unpushed work); other cells just tear down.
const closeConfirm = ref(false);
const closeChecking = ref(false); // refreshing dirty/ahead — the destructive action is held until it's accurate
const closeError = ref<string | null>(null);
const hasUnsaved = computed(() => (diff.value?.dirty ?? 0) > 0 || (diff.value?.ahead ?? 0) > 0);
const unsavedSummary = computed(() => {
  const ahead = diff.value?.ahead ?? 0;
  const dirty = diff.value?.dirty ?? 0;
  const parts: string[] = [];
  if (ahead) parts.push(`${ahead} unpushed commit${ahead > 1 ? "s" : ""}`);
  if (dirty) parts.push(`${dirty} uncommitted change${dirty > 1 ? "s" : ""}`);
  return parts.join(" + ");
});

async function close() {
  if (!isWorktreeCell.value) {
    teardown();
    return;
  }
  closeError.value = null;
  closeConfirm.value = true;
  // Refresh dirty/ahead before the Remove button is enabled, so a fast click can't
  // discard work that became newly dirty/ahead since the last refresh.
  closeChecking.value = true;
  await loadDiff();
  closeChecking.value = false;
}
function cancelClose() {
  closeConfirm.value = false;
  closeChecking.value = false;
  closeError.value = null;
}

async function removeAndClose() {
  const dir = cwd.value;
  if (!dir) {
    teardown();
    return;
  }
  closeError.value = null;
  termRef.value?.terminate(); // free the worktree dir first (Windows locks a process's cwd)
  try {
    const res = await fetch("/api/worktrees/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoDir: dir, path: dir, deleteBranch: true, force: true }),
    });
    if (res.ok) return teardown();
    closeError.value = "Couldn't remove the worktree — it may need manual cleanup.";
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
  loadInitial(id);
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
const status = computed<CellStatus>(() => activityStatus(working.value, waiting.value, activityEvent.value));
const STATUS_CLASS = { blocked: "is-blocked", done: "is-done", working: "is-working", idle: "is-idle" } as const;
const STATUS_LABEL = { blocked: "Needs input", done: "Done — review", working: "Working…", idle: "Idle" } as const;
const statusClass = computed(() => STATUS_CLASS[status.value]);
const statusLabel = computed(() => STATUS_LABEL[status.value]);
watch(status, (s) => emit("status", s), { immediate: true });

const headerText = computed(() => aiTitle.value || lastPrompt.value || (sessionId.value ? sessionId.value.slice(0, 8) : "starting…"));

// Per-cell token usage badge: ⇡ total input (fresh + cache) · ⇣ output generated.
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return String(n);
}
const usageIn = computed(() => (usage.value ? usage.value.inputTokens + usage.value.cacheReadTokens + usage.value.cacheCreationTokens : 0));
const usageOut = computed(() => usage.value?.outputTokens ?? 0);
const showUsage = computed(() => usageIn.value + usageOut.value > 0);
const usageLabel = computed(() => `⇡${fmtTokens(usageIn.value)} ⇣${fmtTokens(usageOut.value)}`);
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
    const res = await fetch(`/api/worktrees/diff?cwd=${encodeURIComponent(cwd.value)}`);
    if (reqId !== diffReq) return;
    const data = res.ok ? await res.json() : null;
    if (reqId !== diffReq) return;
    diff.value = data && data.isWorktree ? data : null;
  } catch {
    if (reqId === diffReq) diff.value = null;
  }
}

function openDiff() {
  diffOpen.value = true;
  prMsg.value = null;
  loadDiff(); // refresh on open
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
const REASON_MSG: Record<string, string> = {
  "not-worktree": "Not a worktree",
  "no-branch": "No branch to push",
  "no-remote": "No git remote (origin) configured",
  "no-github": "Not a GitHub repo — push succeeded; open the PR manually",
  "push-failed": "Push failed",
  failed: "Failed",
};
const reasonMsg = (reason?: string) => REASON_MSG[reason ?? ""] ?? "Failed";

async function worktreeAction(endpoint: "push" | "pr"): Promise<Record<string, unknown> | null> {
  if (!cwd.value || prBusy.value) return null;
  prBusy.value = true;
  prMsg.value = endpoint === "push" ? "Pushing…" : "Creating PR…";
  try {
    const res = await fetch(`/api/worktrees/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: cwd.value }),
    });
    const data = await res.json().catch(() => null);
    // A non-JSON / empty-body response (e.g. a 403 from the origin guard) must not
    // leave the UI stuck on the optimistic "Pushing…" text.
    if (!data) prMsg.value = res.status === 403 ? "Not allowed (origin)" : "Request failed";
    return data;
  } catch {
    prMsg.value = endpoint === "push" ? "Push failed" : "PR failed";
    return null;
  } finally {
    prBusy.value = false;
  }
}

async function pushBranch() {
  const data = await worktreeAction("push");
  if (data) prMsg.value = data.ok ? `Pushed ${data.branch}` : reasonMsg(data.reason as string);
}

async function openPR() {
  const data = await worktreeAction("pr");
  if (!data) return;
  if (data.ok && typeof data.url === "string") {
    window.open(data.url, "_blank", "noopener,noreferrer");
    prMsg.value = data.via === "gh" ? "PR created" : "Opened PR page";
  } else {
    prMsg.value = reasonMsg(data.reason as string);
  }
}

// Refresh when the agent transitions from working → settled: that's when the diff
// is stable and worth re-reading (avoids churn while it's actively editing), and the
// turn's token usage is final.
watch(working, (now, prev) => {
  if (prev && !now) {
    loadDiff();
    refreshUsage();
    refreshGit(); // branch/dirty may have changed (commit, checkout, edits)
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
  <div class="cell" :class="statusClass" :style="cellStyle">
    <template v-if="launched">
      <!-- Row 1 — INFO only: dir + git + model/token + what it's doing. Every icon
           BUTTON lives on row 2 (the embedded terminal's header, via its slot). -->
      <div class="cell-header" :class="[statusClass, { 'is-zoomable': filmstrip }]" :style="headerStyle" @click="onHeaderClick">
        <!-- All the info lives in one shrinkable, clipping track. The chips (badge / git /
             model / tokens / custom) don't shrink, so without this they would overflow and
             push the actions past the cell's `overflow: hidden` edge — the buttons must
             stay reachable no matter how much a dir's config crams in here. -->
        <div class="cell-header-main">
          <span class="cell-dot" :class="statusClass" :title="statusLabel" />
          <!-- Normal grid: the dir is a button that opens it. As a filmstrip thumbnail the
               header's job is to zoom (switch to this terminal), so the dir is inert text
               and a click on it falls through to the header's zoom gesture. -->
          <button v-if="headerDir && !filmstrip" type="button" class="cell-dir" :title="cwd ? `Open ${cwd}` : ''" @click="openDir">
            <span class="cell-dir-path">{{ headerDir }}</span>
          </button>
          <span v-else-if="headerDir" class="cell-dir" :title="cwd ?? ''">
            <span class="cell-dir-path">{{ headerDir }}</span>
          </span>
          <!-- Info (dir badge / git / diff / model / tokens) is dropped on a filmstrip
               thumbnail, leaving only dir + what it's doing + a zoom button. -->
          <template v-if="!filmstrip">
            <span v-if="dirConfig.name" class="cell-badge" :style="dirBadgeStyle" :title="dirConfig.name">{{ dirConfig.name }}</span>
            <template v-for="chip in cellChips" :key="chip.key">
              <GitBranchChip v-if="chip.builtin === 'git'" :status="gitStatus" :hide-dirty="isWorktreeCell" />
              <button
                v-else-if="chip.builtin === 'diff' && showDiffBadge && diff"
                type="button"
                class="cell-wt-badge"
                :title="`View changes vs ${diff.base ?? 'base'}`"
                @click="openDiff"
              >
                <span v-if="diff.ahead > 0" class="wt-ahead">+{{ diff.ahead }}</span>
                <span v-if="diff.dirty > 0" class="wt-dirty-count">●{{ diff.dirty }}</span>
              </button>
              <ModelContextBadge v-else-if="chip.builtin === 'ctx' && context" :agent="agent" :model="context.model" :context-tokens="context.contextTokens" />
              <span v-else-if="chip.builtin === 'usage' && showUsage" class="cell-usage" :title="usageTitle">{{ usageLabel }}</span>
              <span v-else-if="chip.custom" class="cell-hdr-chip" :title="chip.custom.label || chip.custom.text">{{ chip.custom.text }}</span>
            </template>
          </template>
          <span class="cell-prompt" :title="lastPrompt || aiTitle || ''">{{ headerText }}</span>
        </div>
        <!-- Expand/restore + close stay on row 1 (the info row) and OUTSIDE the info
             track, so they're always pinned top-right. `.stop` so they don't trigger the
             header's click-to-zoom. -->
        <span class="cell-actions">
          <button
            class="cell-btn"
            :title="expanded ? 'Restore' : 'Expand'"
            :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
            @click.stop="emit('toggle-expand')"
          >
            {{ expanded ? "⤡" : "⤢" }}
          </button>
          <button class="cell-btn cell-close" title="Close terminal" aria-label="Close terminal" @click.stop="close">✕</button>
        </span>
      </div>
      <TimelineOverlay :session-id="sessionId" :cwd="cwd" :open="timelineOpen" @close="timelineOpen = false" />
      <TerminalView
        ref="termRef"
        class="cell-term"
        :persist-key="`cell-${uid}`"
        :session-id="sessionId"
        :connect-key="connectKey"
        :cwd="cwd"
        :codex="agent === 'codex'"
        :dir-theme="dirConfig.theme"
        :dir-colors="dirConfig.colors"
        :dir-header-color="dirConfig.headerColor"
        :dir-header-text-color="dirConfig.headerTextColor"
        :dir-button-color="dirConfig.buttonColor"
        :hide-header="filmstrip"
        :expanded="expanded"
        :zoomed="zoomed"
        dev-terminal
        run-menu
        @session="onSession"
        @cwd="onServerCwd"
        @run="(cmd) => emit('runSpare', cmd)"
      >
        <!-- Row 2 — the cell's icon actions, gathered onto the terminal's header row. -->
        <template #header-actions>
          <span v-if="githubUrl" ref="ghWrap" class="cell-gh-wrap">
            <button
              type="button"
              class="cell-gh"
              title="Open on GitHub"
              aria-label="Open on GitHub"
              aria-haspopup="true"
              :aria-expanded="ghMenuOpen"
              @click="ghMenuOpen = !ghMenuOpen"
            >
              <svg class="cell-gh-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill-rule="evenodd"
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.6 7.6 0 0 1 8 4.6c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                />
              </svg>
            </button>
            <div v-if="ghMenuOpen" class="cell-gh-menu" @keydown.escape="ghMenuOpen = false">
              <button type="button" class="cell-gh-item" @click="openGithub('')">Repository</button>
              <button type="button" class="cell-gh-item" @click="openGithub('/issues')">Issues</button>
              <button type="button" class="cell-gh-item" @click="openGithub('/pulls')">Pull requests</button>
            </div>
          </span>
          <button
            v-if="sessionId && agent !== 'codex'"
            class="cell-btn"
            title="Activity timeline"
            aria-label="Show activity timeline"
            @click="timelineOpen = true"
          >
            🕘
          </button>
          <button v-if="reorderable" class="cell-btn" title="Move left" aria-label="Move terminal left" @click="emit('move', -1)">◀</button>
          <button v-if="reorderable" class="cell-btn" title="Move right" aria-label="Move terminal right" @click="emit('move', 1)">▶</button>
        </template>
      </TerminalView>
      <div v-if="diffOpen && diff" class="cell-diff">
        <div class="cell-diff-head">
          <span class="cell-diff-title">Changes vs {{ diff?.base ?? "base" }}</span>
          <span class="cell-diff-sum">{{ diff?.ahead ?? 0 }} ahead · {{ diff?.dirty ?? 0 }} uncommitted</span>
          <button class="cell-btn" title="Close diff" aria-label="Close diff" @click="diffOpen = false">✕</button>
        </div>
        <div v-if="diff && diff.files.length" class="cell-diff-files">
          <div v-for="f in diff.files" :key="f.path" class="cell-diff-file">
            <span class="df-path">{{ f.path }}</span>
            <span v-if="f.status === 'untracked'" class="df-new">new</span>
            <span v-else class="df-nums">
              <span class="df-add">+{{ f.additions < 0 ? "bin" : f.additions }}</span>
              <span class="df-del">−{{ f.deletions < 0 ? "bin" : f.deletions }}</span>
            </span>
          </div>
        </div>
        <pre v-if="diff && diff.patch" class="cell-diff-patch">{{ diff.patch }}</pre>
        <p v-if="diff && diff.truncated" class="cell-diff-note">Diff truncated — open the worktree to see the rest.</p>
        <p v-if="diff && !diff.files.length" class="cell-diff-empty">No changes yet.</p>
        <div class="cell-diff-actions">
          <button
            class="cell-diff-btn"
            :disabled="prBusy || working || (diff?.dirty ?? 0) === 0"
            :title="(diff?.dirty ?? 0) === 0 ? 'No uncommitted changes' : working ? 'Wait for the session to finish' : 'Ask Claude to commit the changes'"
            @click="commitViaClaude"
          >
            ✓ Commit
          </button>
          <button
            class="cell-diff-btn"
            :disabled="prBusy || (diff?.ahead ?? 0) === 0"
            :title="(diff?.ahead ?? 0) === 0 ? 'Commit changes first' : 'git push -u origin'"
            @click="pushBranch"
          >
            ⬆ Push
          </button>
          <button
            class="cell-diff-btn"
            :disabled="prBusy || (diff?.ahead ?? 0) === 0"
            :title="(diff?.ahead ?? 0) === 0 ? 'Commit changes in the terminal first' : 'Push and open a pull request'"
            @click="openPR"
          >
            ⧉ Open PR
          </button>
          <span v-if="prMsg" class="cell-diff-msg">{{ prMsg }}</span>
        </div>
      </div>
      <div v-if="closeConfirm" class="cell-close-confirm" role="dialog" aria-modal="true" :aria-label="`Close worktree ${headerDir}`">
        <div class="ccx-box">
          <p class="ccx-title">Close {{ headerDir }}</p>
          <template v-if="!closeError">
            <p v-if="hasUnsaved" class="ccx-warn">{{ unsavedSummary }} will be discarded if you remove the worktree.</p>
            <p v-else class="ccx-sub">Keep the worktree to reuse it later, or remove it.</p>
            <div class="ccx-actions">
              <button class="ccx-btn ccx-keep" @click="teardown">Keep worktree</button>
              <button class="ccx-btn ccx-remove" :disabled="closeChecking" @click="removeAndClose">
                {{ closeChecking ? "Checking…" : hasUnsaved ? "Discard &amp; remove" : "Remove worktree" }}
              </button>
              <button class="ccx-btn ccx-cancel" @click="cancelClose">Cancel</button>
            </div>
          </template>
          <template v-else>
            <p class="ccx-warn">{{ closeError }}</p>
            <div class="ccx-actions">
              <button class="ccx-btn ccx-remove" @click="removeAndClose">Retry</button>
              <button class="ccx-btn" @click="teardown">Close cell</button>
            </div>
          </template>
        </div>
      </div>
    </template>
    <div v-else class="cell-launch">
      <button v-if="cancellable" type="button" class="cell-launch-cancel" title="Cancel new terminal" aria-label="Cancel new terminal" @click="emit('close')">
        ✕
      </button>
      <div v-if="presets.length" class="cell-presets">
        <span v-for="p in presets" :key="p.label + p.path" :class="['cell-chip', { 'is-running': isCwdRunning(p.path) }]">
          <button
            type="button"
            class="cell-chip-main"
            :title="p.path"
            :aria-label="`Use ${p.label} — fill the field to browse / resume here (without launching)`"
            @click="fillDir(p.path)"
          >
            <span v-if="isCwdRunning(p.path)" class="cell-chip-dot" aria-hidden="true" />{{ p.label }}
          </button>
          <button
            type="button"
            class="cell-chip-launch"
            :title="isCwdRunning(p.path) ? `${p.path} — a session is already running here in another terminal` : `Launch a new terminal in ${p.path} now`"
            :aria-label="
              isCwdRunning(p.path) ? `${p.label} — a session is already running here in another terminal` : `Launch a new terminal in ${p.label} now`
            "
            @click="selectPreset(p)"
          >
            <span class="material-symbols-outlined">play_arrow</span>
          </button>
          <button
            type="button"
            class="cell-chip-del"
            :title="`Remove ${p.path} from the list`"
            :aria-label="`Remove ${p.path} from the list`"
            @click="emit('remove-preset', p.path)"
          >
            ✕
          </button>
        </span>
      </div>
      <div class="cell-agent" role="radiogroup" aria-label="Agent">
        <button
          type="button"
          class="cell-agent-btn"
          :class="{ active: agent === 'claude' }"
          role="radio"
          :aria-checked="agent === 'claude'"
          @click="agent = 'claude'"
        >
          Claude
        </button>
        <button
          type="button"
          class="cell-agent-btn"
          :class="{ active: agent === 'codex' }"
          role="radio"
          :aria-checked="agent === 'codex'"
          @click="agent = 'codex'"
        >
          Codex
        </button>
      </div>
      <label class="cell-launch-label">
        <span class="cell-launch-caption">Working directory</span>
        <span class="cell-dir-row">
          <input
            v-model="dirInput"
            class="cell-dir-input"
            type="text"
            placeholder="/path/to/project"
            spellcheck="false"
            @input="dirTouched = true"
            @keydown.enter="launch"
          />
          <button type="button" class="cell-dir-pick" title="Choose a folder…" aria-label="Choose the working directory" @click="pickDir">
            <span class="material-symbols-outlined">folder_open</span>
          </button>
          <button
            type="button"
            class="cell-dir-go"
            :disabled="!dirInput.trim()"
            title="Start a new terminal here (or press Enter)"
            aria-label="Start a new terminal here"
            @click="launch"
          >
            <span class="material-symbols-outlined">play_arrow</span>
          </button>
        </span>
      </label>
      <div v-if="isGitRepo" class="cell-worktrees">
        <span class="cell-launch-caption">or isolate in a worktree (git repo)</span>
        <div class="wt-new">
          <input
            v-model="worktreeTask"
            class="cell-dir-input wt-task"
            type="text"
            placeholder="task name (e.g. fix-login)"
            aria-label="Worktree task name"
            spellcheck="false"
            @keydown.enter="createWorktreeAndLaunch"
          />
          <button class="cell-start wt-start" :disabled="!worktreeTask.trim()" @click="createWorktreeAndLaunch">＋ New worktree</button>
        </div>
        <div v-for="w in worktrees" :key="w.path" class="wt-row">
          <button class="wt-reuse" :title="w.branch ?? w.path" @click="reuseWorktree(w)">
            ⎇ {{ w.task }}<span v-if="w.dirty" class="wt-dirty" title="uncommitted changes">●</span>
          </button>
          <button class="wt-del" title="Remove worktree" aria-label="Remove worktree" @click="removeWorktree(w)">🗑</button>
        </div>
      </div>
      <div v-if="scripts.length" class="cell-scripts">
        <span class="cell-launch-caption">or run a script</span>
        <div class="cell-script-list">
          <button v-for="s in scripts" :key="s.index" class="cell-script-item" :title="s.command" @click="runScript(s)">▶ {{ s.label }}</button>
        </div>
      </div>
      <div v-if="launchers && launchers.length" class="cell-scripts">
        <span class="cell-launch-caption">or launch</span>
        <div class="cell-script-list">
          <button v-for="(l, i) in launchers" :key="l.label" class="cell-script-item" :title="l.command" @click="launchProgram(i, l)">⌘ {{ l.label }}</button>
        </div>
      </div>
      <div v-if="resumable.length" class="cell-resume">
        <span class="cell-launch-caption">or resume here</span>
        <div class="cell-resume-list">
          <button
            v-for="s in resumable"
            :key="s.id"
            :class="['cell-resume-item', { 'is-open': sessionOpenElsewhere(s.id) }]"
            :title="sessionOpenElsewhere(s.id) ? `${s.title} — already open in another terminal` : s.title"
            @click="resume(s)"
          >
            <span class="ri-title">{{ s.title }}</span>
            <span v-if="sessionOpenElsewhere(s.id)" class="ri-open" title="Already open in another terminal">● open</span>
            <span class="ri-time">{{ relativeTime(s.mtime) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cell {
  position: relative; /* anchors the diff overlay */
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  /* Per-dir overrides via .mulmoterminal.json (cellColor/cellBorderColor); the status
     frame below still wins the border while working/blocked. */
  background: var(--cell-bg, var(--bg-base));
  border: 1px solid var(--cell-border, var(--border));
  border-radius: 6px;
  overflow: hidden;
}
/* Frame the whole cell by status: blocked = amber glow (needs you NOW), done = blue
   glow (finished a turn, review it), working = blue border (busy). */
.cell.is-working {
  border-color: var(--accent);
}
.cell.is-done {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
}
.cell.is-blocked {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--amber) 55%, transparent);
}

.cell-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  /* Per-dir override via .mulmoterminal.json (headerColor/headerTextColor) sets these
     vars; the status tint below still wins for the background while working/blocked. */
  background: var(--cell-header-bg, var(--bg-panel));
  color: var(--cell-header-fg, inherit);
  border-bottom: 1px solid var(--border);
}
/* The header also tints by status (working/done = blue, blocked = amber). */
.cell-header.is-working,
.cell-header.is-done {
  background: var(--bg-selected);
  border-bottom-color: var(--accent);
}
.cell-header.is-blocked {
  background: var(--warn-bg-subtle);
  color: var(--warn);
  border-bottom-color: var(--amber);
}
/* A filmstrip thumbnail's header is a click target: zoom (switch to) this terminal.
   Signalled with a pointer cursor + a hover tint so it's discoverable. (Normal grid
   cells are not zoomable by header click — only the ⤢ button.) */
.cell-header.is-zoomable {
  cursor: pointer;
}
.cell-header.is-zoomable:hover {
  background: var(--bg-hover);
}

/* Status dot: idle / working (pulsing blue) / done (static blue) / blocked (amber). */
.cell-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  /* Custom color tints the idle dot; the status classes below override it while
     working/waiting so the activity signal stays intact. */
  background: var(--cell-dot, var(--text-dim));
}
.cell-dot.is-working {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}
.cell-dot.is-done {
  background: var(--accent);
}
.cell-dot.is-blocked {
  background: var(--amber);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.cell-dir {
  flex: 0 1 auto;
  /* Floor the width at ~15 chars of the path so the current dir stays readable
     even on a narrow cell (1ch ≈ one monospace char; the leading … takes one). */
  min-width: 16ch;
  max-width: 60%;
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--cell-header-fg, var(--text-dim));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Truncate from the FRONT so the tail (the project dir) stays visible: in an
     rtl box the ellipsis falls on the left. The inner span keeps the path itself
     in natural left-to-right order (plaintext base direction). */
  direction: rtl;
}
.cell-dir-path {
  unicode-bidi: plaintext;
}
/* Project badge from <cwd>/.mulmoterminal.json — a per-directory identity chip. */
.cell-badge {
  flex: 0 0 auto;
  max-width: 14ch;
  padding: 1px 7px;
  border-radius: 10px;
  font-family: system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-dir:hover {
  color: var(--text-muted);
  text-decoration: underline;
}
.cell-gh-wrap {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
}
.cell-gh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  border-radius: 4px;
}
.cell-gh:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.cell-gh-icon {
  display: block;
  width: 14px;
  height: 14px;
}
.cell-gh-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  margin-top: 4px;
  min-width: 132px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.cell-gh-item {
  text-align: left;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: system-ui, sans-serif;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
}
.cell-gh-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.cell-prompt {
  flex: 1 1 auto;
  min-width: 0;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: var(--cell-header-fg, var(--text-secondary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Per-cell token usage: ⇡ input · ⇣ output. Dim + monospace so it reads as metadata. */
.cell-usage {
  flex: 0 0 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
  letter-spacing: 0.02em;
}

/* A user-defined display-only chip (from the `chips` config). */
.cell-hdr-chip {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
}

/* The info track absorbs all the width pressure: it grows into the free space and,
   crucially, is allowed to shrink below its content (min-width: 0) and clip. That keeps
   the non-shrinking chips from pushing .cell-actions out of the cell. */
.cell-header-main {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Never shrinks, never scrolls away: expand + close stay pinned at the top-right. */
.cell-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
}
.cell-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--cell-btn, var(--text-secondary));
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: 6px;
}
.cell-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.cell-close:hover {
  background: var(--err-hover-bg);
  color: var(--err-text);
}

.cell-term {
  flex: 1;
  min-height: 0;
}

/* Empty cell: pick a directory, then launch. */
.cell-launch {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Top-aligned: the form anchors to the top of the cell rather than floating in
     the vertical middle (which looks adrift when there are few/no resume rows). */
  justify-content: flex-start;
  gap: 8px;
  padding: 16px;
  overflow-y: auto;
}
/* Dismiss an added launcher (anchored to the cell, so it stays put while the form
   scrolls). */
.cell-launch-cancel {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: 6px;
}
.cell-launch-cancel:hover {
  background: var(--err-hover-bg);
  color: var(--err-text);
}
.cell-presets {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-width: 360px;
}
/* A chip is a segmented pill: the main button launches; the tiny end button just
   fills the working-directory field (so the user can resume a session there). */
.cell-chip {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg-elevated);
}
/* A dir already running a session in another cell: tint the chip + show a dot. */
.cell-chip.is-running {
  border-color: color-mix(in srgb, #3b82f6 55%, var(--border));
  background: color-mix(in srgb, #3b82f6 14%, var(--bg-elevated));
}
.cell-chip-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  background: #3b82f6;
  vertical-align: middle;
}
.cell-chip-main {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  padding: 4px 10px;
}
.cell-chip.is-running .cell-chip-main {
  color: var(--text);
}
.cell-chip-launch {
  display: inline-flex;
  align-items: center;
  border: none;
  border-left: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 5px;
}
.cell-chip-launch .material-symbols-outlined {
  font-size: 14px;
}
.cell-chip-del {
  border: none;
  border-left: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  padding: 0 7px;
}
.cell-chip-main:hover,
.cell-chip-launch:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.cell-chip-del:hover {
  background: var(--bg-hover);
  color: var(--danger, #e5484d);
}
.cell-launch-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 360px;
}
.cell-launch-caption {
  font-family: system-ui, sans-serif;
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cell-agent {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-deep);
  align-self: flex-start;
}
.cell-agent-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 14px;
  border-radius: 5px;
}
.cell-agent-btn:hover {
  color: var(--text);
}
.cell-agent-btn.active {
  background: var(--bg-elevated);
  color: var(--text);
}
.cell-dir-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
}
.cell-dir-input:focus {
  outline: none;
  border-color: var(--accent);
}
.cell-dir-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  width: 100%;
}
.cell-dir-row .cell-dir-input {
  flex: 1 1 auto;
  min-width: 0;
}
.cell-dir-go,
.cell-dir-pick {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}
.cell-dir-go:hover:not(:disabled),
.cell-dir-pick:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent);
}
.cell-dir-go:disabled {
  opacity: 0.4;
  cursor: default;
}
.cell-dir-go .material-symbols-outlined,
.cell-dir-pick .material-symbols-outlined {
  font-size: 18px;
}
.cell-start {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 7px 16px;
  border-radius: 6px;
}
.cell-start:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.cell-worktrees {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  max-width: 360px;
}
.wt-new {
  display: flex;
  gap: 6px;
}
.wt-task {
  flex: 1 1 auto;
  min-width: 0; /* let the input shrink so the button keeps its width */
  width: auto;
}
.wt-start {
  flex: 0 0 auto;
  white-space: nowrap;
}
.wt-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.wt-reuse {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wt-reuse:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.wt-dirty {
  margin-left: 6px;
  color: var(--warn-text, #e0a030);
}
.wt-del {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 6px;
}
.wt-del:hover {
  background: var(--err-hover-bg);
}

.cell-scripts {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 360px;
}
.cell-script-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  width: 100%;
}
.cell-script-item {
  border: 1px solid #2a4e3a;
  background: #16271d;
  color: #b6e3c7;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 14px;
}
.cell-script-item:hover {
  background: #1f3a2a;
  border-color: #3fae6b;
  color: #fff;
}

.cell-resume {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 360px;
  min-height: 0;
}
.cell-resume-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
.cell-resume-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--border);
  background: var(--bg-deep);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  text-align: left;
  padding: 5px 10px;
  border-radius: 6px;
}
.cell-resume-item:hover {
  background: var(--bg-elevated);
  border-color: var(--accent);
}
.ri-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ri-time {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 11px;
}
.cell-resume-item.is-open {
  border-color: var(--amber);
}
.ri-open {
  flex: 0 0 auto;
  color: var(--amber);
  font-size: 11px;
  white-space: nowrap;
}

/* Worktree diff badge in the header (ahead / uncommitted), opens the diff panel. */
.cell-wt-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  cursor: pointer;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
}
.cell-wt-badge:hover {
  background: var(--bg-hover);
}
.wt-ahead {
  color: var(--accent);
}
.wt-dirty-count {
  color: var(--warn-text, #e0a030);
}

/* Read-only diff panel: overlays the terminal area of the cell. */
.cell-diff {
  position: absolute;
  inset: 34px 0 0 0; /* below the 34px header */
  z-index: 15;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  border-top: 1px solid var(--border);
  overflow: hidden;
}
.cell-diff-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.cell-diff-title {
  font-family: system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.cell-diff-sum {
  flex: 1 1 auto;
  font-family: system-ui, sans-serif;
  font-size: 11px;
  color: var(--text-dim);
}
.cell-diff-files {
  flex: 0 0 auto;
  max-height: 35%;
  overflow-y: auto;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
}
.cell-diff-file {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  padding: 1px 0;
}
.df-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  direction: rtl;
  color: var(--text-secondary);
}
.df-nums {
  flex: 0 0 auto;
}
.df-add {
  color: #3fae6b;
}
.df-del {
  color: var(--err-text, #e0556b);
}
.df-new {
  flex: 0 0 auto;
  color: #3fae6b;
}
.cell-diff-patch {
  flex: 1 1 auto;
  margin: 0;
  overflow: auto;
  padding: 8px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
  white-space: pre;
  tab-size: 2;
}
.cell-diff-note,
.cell-diff-empty {
  margin: 0;
  padding: 8px;
  font-family: system-ui, sans-serif;
  font-size: 11px;
  color: var(--text-dim);
}
.cell-diff-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}
.cell-diff-btn {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
}
.cell-diff-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.cell-diff-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cell-diff-msg {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: system-ui, sans-serif;
  font-size: 11px;
  color: var(--text-dim);
}

/* Close confirmation: keep or remove the worktree before tearing the cell down. */
.cell-close-confirm {
  position: absolute;
  inset: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, var(--bg-base) 82%, transparent);
}
.ccx-box {
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.ccx-title {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.ccx-sub {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: var(--text-dim);
}
.ccx-warn {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: var(--warn-text, #e0a030);
}
.ccx-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ccx-btn {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
}
.ccx-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.ccx-keep {
  border-color: var(--accent);
  color: var(--text);
}
.ccx-remove:hover {
  background: var(--err-hover-bg);
  color: var(--err-text);
  border-color: var(--err-text, #e0556b);
}
</style>
