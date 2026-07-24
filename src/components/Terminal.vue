<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch, nextTick } from "vue";
import { type ITheme } from "@xterm/xterm";
import { FLIP_MS, shouldRefocusOnZoomChange } from "./cellFlip";
import { terminalManagesAttention, terminalViewActive } from "./terminalViewActive";
import { dragCarriesFiles, dropTextFromUriList } from "./dropPaths";
import { translateUiSentence } from "../utils/translateUi";
import { useTheme, currentTermTheme, termThemeFor, type ThemeId } from "../composables/useTheme";
import { badgeStyleFor } from "./dirBadge";
import { terminalHeaderStyleFor } from "./cellHeaderStyle";
import { useVoiceInput } from "../composables/useVoiceInput";
import { useGitStatus } from "../composables/useGitStatus";
import * as conn from "../composables/useTerminalConnections";
import RunMenu from "./RunMenu.vue";
import SkillMenu from "./SkillMenu.vue";
import { skillSeed } from "./skillSeed";
import GitBranchChip from "./GitBranchChip.vue";
import { useHeaderButtons, hasPickFileButton, type HeaderButton } from "../composables/useHeaderButtons";
import { useSessionContext } from "../composables/useSessionContext";
import { runHeaderButton } from "../composables/useHeaderAction";
import type { RunCommand } from "./runCommand";
import type { LaunchChoice } from "./wsUrl";

// `null` => start a fresh session; otherwise resume the given session id.
// `connectKey` increments on every user action so re-selecting the same
// session (or starting another fresh one) still forces a reconnect.
// `devTerminal` runs claude as a plain dev terminal (the grid): NO GUI plugin MCP
// and NO --strict-mcp-config, so the user's (~/.claude.json) + project's (.mcp.json)
// MCP servers load normally. Default (false, the single view) keeps main's behavior:
// the in-process GUI MCP attached and isolated with --strict-mcp-config.
// `command` switches the terminal to a plain shell command (the grid's Run menu):
// it connects to /ws/run with the script index instead of resuming a Claude
// session, and never auto-reconnects (the ephemeral process can't be resumed).
// `runMenu` adds a ▶ Run dropdown to the header (the single view) that lists the
// open project's script.json and emits the picked command for the parent to run,
// plus a ⚡ Skill dropdown that lists the project's .claude/skills and invokes the
// picked one in this session (types its /<slug>).
// `persistKey` opts this terminal into a durable connection (kept alive across
// unmount via useTerminalConnections, keyed by this stable slot id — the grid cell's
// uid or the single view). Absent => an ephemeral slot torn down on unmount (command
// cells, whose Run process can't be resumed anyway).
const props = defineProps<{
  sessionId: string | null;
  connectKey: number;
  cwd?: string | null;
  devTerminal?: boolean;
  command?: RunCommand | null;
  // A configured launcher (shell/codex/command) by index, or the OS default shell
  // (`{ shell: true }`) — persistent & reattachable, connects to /ws/launch instead of
  // resuming a Claude session.
  launcher?: { index: number } | { shell: true } | null;
  // A first-class codex session — connects to /ws/codex instead of /ws (Claude).
  codex?: boolean;
  // Provider/model picked in the launch form, for this session only (#584).
  launch?: LaunchChoice | null;
  runMenu?: boolean;
  // Hide this terminal's own header row (used when a grid cell is zoomed: the cell's
  // header already shows dir + activity, so the embedded header would just be clutter).
  hideHeader?: boolean;
  // Grid zoom state, so the terminal can grab keyboard focus after an expand/collapse teleport
  // (which blurs it). `expanded` = this cell is the big one; `zoomed` = SOME cell is expanded.
  expanded?: boolean;
  zoomed?: boolean;
  persistKey?: string | null;
  // Per-directory overrides from <cwd>/.mulmoterminal.json. `dirTheme` pins this
  // terminal's xterm palette (overriding the app-wide theme for this cell only);
  // `dirColors` overrides individual palette keys on top of that; `dirName` /
  // `dirBadgeColor` render a project badge in the header.
  dirTheme?: ThemeId | null;
  dirColors?: Partial<ITheme> | null;
  dirName?: string | null;
  dirBadgeColor?: string | null;
  // The header row's own colors (matches the grid cell's row-1 header): background,
  // text, and the icon buttons. Hex #rrggbb or null for the theme default.
  dirHeaderColor?: string | null;
  dirHeaderTextColor?: string | null;
  dirButtonColor?: string | null;
}>();
const emit = defineEmits<{
  (e: "session" | "cwd", value: string): void;
  (e: "exit"): void;
  (e: "run", command: RunCommand): void;
}>();

// The durable runtime (socket + xterm) lives in the manager, keyed by a stable slot
// id. A persisted slot survives this component's unmount; an ephemeral one is torn
// down. Captured once — the key is stable for the component's life.
const slotKey = props.persistKey ?? `ephemeral-${crypto.randomUUID()}`;
function currentTarget(): conn.ConnTarget {
  return {
    sessionId: props.sessionId,
    cwd: props.cwd ?? null,
    devTerminal: !!props.devTerminal,
    command: props.command ?? null,
    launcher: props.launcher ?? null,
    codex: !!props.codex,
    launch: props.launch ?? null,
  };
}

const terminalRef = ref<HTMLDivElement>();
// Connection status + server-resolved cwd are projected reactively from the manager.
const status = computed(() => conn.connView.get(slotKey)?.status ?? "connecting");
// Connection pill colours. The *-bg tokens aren't in Tailwind's palette, so the
// backgrounds come through as arbitrary var() values.
const statusClass = computed(() => {
  if (status.value === "connected") return "bg-[var(--ok-bg)] text-ok";
  if (status.value === "connecting") return "bg-[var(--warn-bg)] text-warn";
  return "bg-[var(--err-deep)] text-err";
});
// The server-resolved cwd of the connected session (the open project), used by the
// Run menu so it lists THAT directory's scripts. Falls back to the requested cwd.
const serverCwd = computed(() => conn.connView.get(slotKey)?.serverCwd ?? props.cwd ?? null);

// The running model, so header buttons/chips can substitute `${model}`.
const { context: sessionContext } = useSessionContext(
  computed(() => props.sessionId),
  serverCwd,
);
// Resolved header action buttons for this session's dir (GET /api/header) — the user's config, or the
// built-in defaults when unconfigured. They target the running agent session, so they're suppressed on a
// command/launcher terminal — those embed Terminal without a session and don't handle `run`.
const headerButtonsCwd = computed(() => (props.command || props.launcher ? null : serverCwd.value));
const { buttons: headerButtons } = useHeaderButtons({
  cwd: headerButtonsCwd,
  session: computed(() => props.sessionId),
  agent: computed<"claude" | "codex">(() => (props.codex ? "codex" : "claude")),
  model: computed(() => sessionContext.value?.model ?? null),
});

// `input`/`open` dispatch client-side. `shell` hands off to a command cell: the browser never holds the
// command — it emits the button id + this session's context, and the server re-resolves it (see /ws/run).
function onHeaderButton(button: HeaderButton): void {
  if (button.run !== "shell") {
    runHeaderButton(button, slotKey, serverCwd.value);
    return;
  }
  const command: RunCommand = {
    source: "button",
    buttonId: button.id,
    label: button.label,
    cwd: serverCwd.value,
    session: props.sessionId,
    agent: props.codex ? "codex" : "claude",
    model: sessionContext.value?.model ?? null,
  };
  emit("run", command);
}
// A skill picked from the header Skill menu runs IN this session (not a spare cell
// like a script): type its invocation and submit, exactly like a `run:"input"` button.
function onSkill(slug: string): void {
  conn.submitText(slotKey, skillSeed(slug, props.codex ?? false));
}

// Git status chip — single view only. In the grid the embedding TerminalCell shows
// its own chip, so null the cwd here to skip redundant polling (status stays null).
const gitCwd = computed(() => (props.devTerminal ? null : serverCwd.value));
const { status: gitStatus } = useGitStatus(gitCwd);
const dragOver = ref(false);
const { themeId } = useTheme();

// A dir-pinned theme wins over the app-wide selection for this terminal's canvas,
// then per-key `dirColors` override on top (so a dir can tweak just the background
// without restating a whole palette).
function effectiveTermTheme(): ITheme {
  const base = props.dirTheme ? termThemeFor(props.dirTheme) : currentTermTheme();
  return props.dirColors ? { ...base, ...props.dirColors } : base;
}
const dirBadgeStyle = computed(() => badgeStyleFor(props.dirBadgeColor));
const headerStyle = computed(() => terminalHeaderStyleFor(props.dirHeaderColor, props.dirHeaderTextColor, props.dirButtonColor));

// Voice input: a mic in the header transcribes speech (locally, via whisper.cpp)
// and inserts it at the prompt for the user to review and submit — same channel as
// a typed path. `insertText` is hoisted (function declaration), so referencing it
// here before its definition is fine; it only runs at transcript time.
// Append a trailing space so consecutive VAD segments stay separated ("hello
// world", not "helloworld") when dictating multiple phrases into the prompt.
const voice = useVoiceInput({ onTranscript: (text) => insertText(`${text} `) });
function voiceTitle(): string {
  if (voice.listening.value) return "Stop voice input";
  if (voice.downloading.value) return "Downloading speech model…";
  if (!voice.available.value) return "Enable voice input (downloads the speech model)";
  return "Start voice input";
}
function voiceIcon(): string {
  if (voice.listening.value) return "stop";
  if (voice.downloading.value || voice.transcribing.value) return "progress_activity";
  return "mic";
}

let resizeObserver: ResizeObserver;

onMounted(() => {
  // Probe voice-input capability so the mic button shows only where supported.
  voice.refreshAvailability().catch(() => {});

  const container = terminalRef.value;
  if (!container) return;
  // Attach this view to its durable slot: creates + connects the runtime on first
  // mount, or re-parents the already-live xterm here on a remount (no cold resume).
  // session/cwd/exit are forwarded so the parent's existing wiring is unchanged.
  conn.attach(
    slotKey,
    currentTarget(),
    {
      onSession: (id) => emit("session", id),
      onCwd: (c) => emit("cwd", c),
      onExit: () => emit("exit"),
    },
    container,
    effectiveTermTheme(),
  );

  // Auto-resize: fit the slot's xterm to this container and push the size to the PTY.
  resizeObserver = new ResizeObserver(() => conn.fit(slotKey));
  resizeObserver.observe(container);
});

// This cell may live under <KeepAlive> (the grid): a top-tab switch DEACTIVATES it,
// moving its DOM to the cache rather than unmounting. A detached element gets no
// ResizeObserver callbacks, so — unlike display:none — the xterm is never fit to a zero
// box and the PTY keeps its size. Still, stop observing while cached (hygiene) and force
// a refit on return, so a window resize that happened while the grid was away is applied.
onDeactivated(() => resizeObserver?.disconnect());
onActivated(() => {
  const container = terminalRef.value;
  if (container) resizeObserver?.observe(container);
  conn.fit(slotKey);
  // Refocusing the right cell on return is driven centrally by TerminalGrid (which knows
  // the last-focused cell) — a per-cell focus here would fight it across cells.
});

// Reconnect (resume a different session / start fresh) on every user action.
// A user action picks a new target, so point the slot at the new session/cwd and
// reconnect (closing the previous socket, which falls back to the server's grace).
watch(
  () => props.connectKey,
  () => {
    conn.retarget(slotKey, currentTarget());
    conn.focus(slotKey);
  },
);

// Report to the server whether this terminal is the user's actively-viewed pane, so
// an unfocused grid cell can surface blocked/done and a viewed one stays suppressed.
const managesAttention = computed(() => terminalManagesAttention(!!props.command, !!props.launcher));
const viewActive = computed(() => terminalViewActive(!!props.devTerminal, !!props.expanded));
function pushView(active: boolean) {
  if (managesAttention.value) conn.sendView(slotKey, active);
}
// Send on (re)connect and whenever zoom changes. A persisted slot keeps its socket
// open across deactivate/unmount (kept-alive grid page switch, single<->grid toggle),
// so we MUST clear `active` when hidden — otherwise the server keeps suppressing
// blocked/done for a session the user is no longer viewing. Re-assert on show.
watch([status, viewActive], ([s, active]) => {
  if (s === "connected") pushView(active);
});
onDeactivated(() => pushView(false));
onActivated(() => pushView(viewActive.value));
onUnmounted(() => pushView(false));

// xterm can't read CSS variables, so repaint its canvas palette when the theme
// changes (keeps an already-open terminal in sync with the rest of the app). A
// dir-pinned theme ignores the app-wide change; a change to the pin itself repaints.
watch([themeId, () => props.dirTheme, () => props.dirColors], () => {
  conn.setTheme(slotKey, effectiveTermTheme());
});

// Expanding/collapsing a grid cell teleports it in the DOM, which blurs the xterm textarea — so the
// user has to click before typing. Refocus the cell that should now be active: the one that became
// big (expanded), or the one returning to the grid on a full collapse (`!zoomed`). On a switch to
// ANOTHER cell (still zoomed) we skip, letting the newly-big cell claim focus. Refocus once after the
// teleport (nextTick, covers reduced-motion) and again once the FLIP animation lands.
let refocusTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.expanded,
  (expanded) => {
    // Cancel this cell's pending refocus FIRST, before the early return: a cell that just shrank
    // (A → B) must drop its stale timer, or it fires ~FLIP_MS later and steals focus back. Clearing
    // here means a surviving timer only ever reflects the cell's current, unchanged state.
    clearTimeout(refocusTimer);
    if (!shouldRefocusOnZoomChange(!!expanded, props.zoomed)) return;
    nextTick(() => conn.focus(slotKey));
    refocusTimer = setTimeout(() => conn.focus(slotKey), FLIP_MS + 30);
  },
);
onUnmounted(() => clearTimeout(refocusTimer));

// Submit a GUI-originated message into the PTY (the GUI->LLM feedback path) and the
// explicit ✕ close. Both delegate to the slot's durable runtime.
function submitText(text: string): boolean {
  return conn.submitText(slotKey, text);
}
function terminate() {
  conn.terminate(slotKey);
}
// The current xterm buffer as plain text, so a command cell can send its captured
// output to the AI summariser.
function readOutput(): string {
  return conn.readBuffer(slotKey);
}
defineExpose({ submitText, terminate, readOutput });

// Insert text (a path, or space-joined paths) at the terminal cursor via the
// normal input channel — no trailing CR, so the user reviews and submits.
function insertText(text: string) {
  conn.insertText(slotKey, text);
}

// Drop a file onto the terminal to insert its absolute path, like a native
// terminal. Browsers expose the real path only via the drag's file:// URIs
// (text/uri-list); the File object hides it. Browsers that withhold the path
// (e.g. Chrome) yield no URIs — instead of silently inserting nothing, point the
// user at the 📎 file-picker button, which is the path-in-Chrome route.
function onDrop(e: DragEvent) {
  dragOver.value = false;
  const dt = e.dataTransfer;
  if (!dt || !dragCarriesFiles(dt.types)) return; // not a file drop — leave text drags alone
  e.preventDefault();
  const text = dropTextFromUriList(dt.getData("text/uri-list") || dt.getData("text/plain"));
  if (text) insertText(text);
  else showDropHint();
}

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer || !dragCarriesFiles(e.dataTransfer.types)) return;
  e.preventDefault(); // required for the drop event to fire
  dragOver.value = true;
}

// Shown when a file was dropped but the browser withheld its path — the drop can't do
// anything, so tell the user how to insert the path rather than leaving the failed drop
// looking like nothing happened. The guidance depends on the header: point at the 📎 picker
// only when it's actually present (buttons are configurable and it can be removed), otherwise
// fall back to advice that always holds.
const DROP_HINT_PICKER_EN = "This browser doesn't share a dropped file's path. Use the 📎 button in the header (Insert a file path) instead.";
const DROP_HINT_TYPE_EN = "This browser doesn't share a dropped file's path — type or paste the path instead.";
const dropHint = ref(false);
const dropHintText = ref("");
const DROP_HINT_MS = 6000;
let dropHintTimer: ReturnType<typeof setTimeout> | undefined;
async function showDropHint() {
  const english = hasPickFileButton(headerButtons.value) ? DROP_HINT_PICKER_EN : DROP_HINT_TYPE_EN;
  dropHintText.value = english; // show immediately; the translation (server-cached) swaps in
  dropHint.value = true;
  clearTimeout(dropHintTimer);
  dropHintTimer = setTimeout(() => (dropHint.value = false), DROP_HINT_MS);
  const translated = await translateUiSentence(english, "mulmoterminal-ui");
  if (dropHint.value) dropHintText.value = translated; // ignore if it resolved after the hint hid
}
onUnmounted(() => clearTimeout(dropHintTimer));

onUnmounted(() => {
  resizeObserver?.disconnect();
  // Persisted slot: detach the view but KEEP the connection alive (the whole point —
  // navigating away / off-page paging doesn't reap the PTY). Ephemeral slot (command
  // cells, whose process is unresumable): tear it down as before.
  if (props.persistKey) conn.detach(slotKey, terminalRef.value ?? null);
  else conn.release(slotKey);
});
</script>

<template>
  <div class="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-base">
    <div
      v-if="!hideHeader"
      class="flex items-center gap-3 bg-[var(--cell-header-bg,var(--bg-panel))] px-4 py-2 font-sans text-[14px] text-[var(--cell-header-fg,var(--text))]"
      :style="headerStyle"
    >
      <span class="font-semibold">Terminal</span>
      <span
        v-if="dirName"
        class="max-w-[16ch] truncate rounded-[10px] px-2 py-px text-[11px] font-semibold leading-[1.6]"
        :style="dirBadgeStyle"
        :title="dirName"
        >{{ dirName }}</span
      >
      <GitBranchChip :status="gitStatus" />
      <span class="rounded-[4px] px-2 py-0.5 text-[12px]" :class="statusClass">{{ status }}</span>
      <RunMenu v-if="runMenu" :cwd="serverCwd" @run="(c) => emit('run', c)" />
      <SkillMenu v-if="runMenu" :cwd="serverCwd" @skill="onSkill" />
      <div class="ml-auto inline-flex items-center gap-1">
        <button
          v-for="b in headerButtons"
          :key="b.id"
          type="button"
          class="inline-flex cursor-pointer items-center rounded-[4px] border-0 bg-transparent p-0.5 text-[var(--cell-btn,var(--text-muted))] hover:bg-selected hover:text-fg"
          :title="b.label"
          :aria-label="b.label"
          @click="onHeaderButton(b)"
        >
          <span v-if="b.emoji" class="text-[15px] leading-none">{{ b.emoji }}</span>
          <span v-else class="material-symbols-outlined text-[18px]">{{ b.icon || "bolt" }}</span>
        </button>
        <button
          v-if="voice.capable.value"
          type="button"
          class="inline-flex cursor-pointer items-center rounded-[4px] border-0 bg-transparent p-0.5 text-[var(--cell-btn,var(--text-muted))] hover:bg-selected hover:text-fg"
          :class="['voice', { listening: voice.listening.value, busy: voice.downloading.value || voice.transcribing.value }]"
          :title="voiceTitle()"
          :aria-label="voiceTitle()"
          @click="voice.toggle()"
        >
          <span class="material-symbols-outlined text-[18px]">{{ voiceIcon() }}</span>
        </button>
        <!-- The file-path picker and file explorer are now DEFAULT_BUTTONS (server-resolved into
             headerButtons above), so the user can drop/reorder/replace them via config. -->
        <!-- A grid cell injects its own actions (GitHub / timeline / reorder / zoom /
             close) here, so all the icon buttons live on this one header row. -->
        <slot name="header-actions" />
      </div>
    </div>
    <div
      ref="terminalRef"
      class="min-h-0 flex-1 p-1"
      :class="{ '[outline:2px_dashed_var(--accent)] [outline-offset:-2px]': dragOver }"
      @dragover="onDragOver"
      @dragleave="dragOver = false"
      @drop="onDrop"
    />
    <Transition
      enter-active-class="transition-opacity duration-200 ease-[ease]"
      leave-active-class="transition-opacity duration-200 ease-[ease]"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="dropHint"
        class="pointer-events-none absolute bottom-3 left-1/2 z-20 flex max-w-[min(90%,560px)] -translate-x-1/2 items-center gap-2 rounded-lg border-2 border-[#c98a00] bg-[#ffd54a] px-4 py-2.5 font-sans text-[13px] font-semibold leading-[1.4] text-[#1a1a2e] shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
        role="status"
      >
        <span class="material-symbols-outlined shrink-0 text-[18px]" aria-hidden="true">attach_file</span>
        <span>{{ dropHintText }}</span>
      </div>
    </Transition>
  </div>
</template>

<!-- The voice button's recording pulse / busy spin need @keyframes, which have no
     utility equivalent — the rest of the header is utilities. These target .voice
     directly (the icon-btn base is now utilities). -->
<style scoped>
.voice.listening {
  color: #e5484d;
  animation: voice-pulse 1.2s ease-in-out infinite;
}

.voice.busy .material-symbols-outlined {
  animation: voice-spin 1s linear infinite;
}

@keyframes voice-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@keyframes voice-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
