<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { type ITheme } from "@xterm/xterm";
import { dropTextFromUriList, toInsertText } from "./dropPaths";
import { useTheme, currentTermTheme, termThemeFor, type ThemeId } from "../composables/useTheme";
import { badgeStyleFor } from "./dirBadge";
import { terminalHeaderStyleFor } from "./cellHeaderStyle";
import { useVoiceInput } from "../composables/useVoiceInput";
import { useGitStatus } from "../composables/useGitStatus";
import * as conn from "../composables/useTerminalConnections";
import RunMenu from "./RunMenu.vue";
import GitBranchChip from "./GitBranchChip.vue";
import { filesGotoIndex } from "../composables/useFilesView";
import { useHeaderButtons, type HeaderButton } from "../composables/useHeaderButtons";
import { useSessionContext } from "../composables/useSessionContext";
import { runHeaderButton } from "../composables/useHeaderAction";
import type { RunCommand } from "./runCommand";

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
// open project's script.json and emits the picked command for the parent to run.
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
  // A configured launcher (shell/codex/command) — persistent & reattachable, connects
  // to /ws/launch instead of resuming a Claude session.
  launcher?: { index: number } | null;
  // A first-class codex session — connects to /ws/codex instead of /ws (Claude).
  codex?: boolean;
  runMenu?: boolean;
  // Hide this terminal's own header row (used when a grid cell is zoomed: the cell's
  // header already shows dir + activity, so the embedded header would just be clutter).
  hideHeader?: boolean;
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
  };
}

const terminalRef = ref<HTMLDivElement>();
// Connection status + server-resolved cwd are projected reactively from the manager.
const status = computed(() => conn.connView.get(slotKey)?.status ?? "connecting");
// The server-resolved cwd of the connected session (the open project), used by the
// Run menu so it lists THAT directory's scripts. Falls back to the requested cwd.
const serverCwd = computed(() => conn.connView.get(slotKey)?.serverCwd ?? props.cwd ?? null);

// The running model, so header buttons/chips can substitute `${model}`.
const { context: sessionContext } = useSessionContext(
  computed(() => props.sessionId),
  serverCwd,
);
// User-configured header action buttons for this session's dir (GET /api/header). Additive: with no
// config the list is empty so the header is unchanged.
const { buttons: headerButtons } = useHeaderButtons({
  cwd: serverCwd,
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

// xterm can't read CSS variables, so repaint its canvas palette when the theme
// changes (keeps an already-open terminal in sync with the rest of the app). A
// dir-pinned theme ignores the app-wide change; a change to the pin itself repaints.
watch([themeId, () => props.dirTheme, () => props.dirColors], () => {
  conn.setTheme(slotKey, effectiveTermTheme());
});

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
// (e.g. Chrome) yield no URIs, so we insert nothing rather than a wrong string —
// the file-picker button is the path-in-Chrome route.
function onDrop(e: DragEvent) {
  dragOver.value = false;
  const dt = e.dataTransfer;
  if (!dt || dt.files.length === 0) return; // not a file drop — leave text drags alone
  e.preventDefault();
  insertText(dropTextFromUriList(dt.getData("text/uri-list") || dt.getData("text/plain")));
}

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault(); // required for the drop event to fire
  dragOver.value = true;
}

// The file-icon button: the browser can't reveal a real path, so the local
// server opens the OS file dialog and returns the chosen absolute path(s). Works
// in every browser (the cross-browser path route, unlike file:// drag/drop).
async function pickFile() {
  try {
    const res = await fetch("/api/pick-file", { method: "POST", headers: { "content-type": "application/json" } });
    if (!res.ok) return;
    const data: unknown = await res.json();
    const paths = isRecord(data) && Array.isArray(data.paths) ? data.paths.filter((p): p is string => typeof p === "string") : [];
    insertText(toInsertText(paths));
  } catch {
    // best-effort — the native dialog is unavailable or the user canceled
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

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
  <div class="terminal-wrapper">
    <div v-if="!hideHeader" class="header" :style="headerStyle">
      <span class="title">Terminal</span>
      <span v-if="dirName" class="dir-badge" :style="dirBadgeStyle" :title="dirName">{{ dirName }}</span>
      <GitBranchChip :status="gitStatus" />
      <span :class="['status', status]">{{ status }}</span>
      <RunMenu v-if="runMenu" :cwd="serverCwd" @run="(c) => emit('run', c)" />
      <div class="header-actions">
        <button
          v-for="b in headerButtons"
          :key="b.id"
          type="button"
          class="icon-btn hdr-action"
          :title="b.label"
          :aria-label="b.label"
          @click="onHeaderButton(b)"
        >
          <span v-if="b.emoji" class="hdr-emoji">{{ b.emoji }}</span>
          <span v-else class="material-symbols-outlined">{{ b.icon || "bolt" }}</span>
        </button>
        <button
          v-if="voice.capable.value"
          type="button"
          :class="['icon-btn', 'voice', { listening: voice.listening.value, busy: voice.downloading.value || voice.transcribing.value }]"
          :title="voiceTitle()"
          :aria-label="voiceTitle()"
          @click="voice.toggle()"
        >
          <span class="material-symbols-outlined">{{ voiceIcon() }}</span>
        </button>
        <button type="button" class="icon-btn" title="Insert a file path" aria-label="Insert a file path" @click="pickFile">
          <span class="material-symbols-outlined">attach_file</span>
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Browse & edit this project's files"
          aria-label="Open the file explorer"
          @click="filesGotoIndex(serverCwd)"
        >
          <span class="material-symbols-outlined">folder_open</span>
        </button>
        <!-- A grid cell injects its own actions (GitHub / timeline / reorder / zoom /
             close) here, so all the icon buttons live on this one header row. -->
        <slot name="header-actions" />
      </div>
    </div>
    <div ref="terminalRef" :class="['terminal-container', { 'drag-over': dragOver }]" @dragover="onDragOver" @dragleave="dragOver = false" @drop="onDrop" />
  </div>
</template>

<style scoped>
.terminal-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--bg-base);
}

.header {
  padding: 8px 16px;
  /* Per-dir overrides via .mulmoterminal.json (headerColor/headerTextColor); matches
     the grid cell's row-1 header so both header rows share the look. */
  background: var(--cell-header-bg, var(--bg-panel));
  color: var(--cell-header-fg, var(--text));
  font-family: system-ui, sans-serif;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-weight: 600;
}

/* Project badge from <cwd>/.mulmoterminal.json — a per-directory identity chip. */
.dir-badge {
  max-width: 16ch;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--cell-btn, var(--text-muted));
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--bg-selected);
  color: var(--text);
}

.icon-btn .material-symbols-outlined {
  font-size: 18px;
}
/* A configured action button's emoji glyph, sized to sit with the icon buttons. */
.hdr-emoji {
  font-size: 15px;
  line-height: 1;
}

/* Recording: solid red, gently pulsing. Busy (download/transcribe): the spinner
   icon rotates. */
.icon-btn.voice.listening {
  color: #e5484d;
  animation: voice-pulse 1.2s ease-in-out infinite;
}

.icon-btn.voice.busy .material-symbols-outlined {
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

.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}

.status.connected {
  background: var(--ok-bg);
  color: var(--ok);
}

.status.connecting {
  background: var(--warn-bg);
  color: var(--warn);
}

.status.disconnected {
  background: var(--err-deep);
  color: var(--err);
}

/* min-height:0 is load-bearing: a flex item's default min-height is `auto`
   (its content's min size), which pins this xterm host to the terminal's full
   rendered height. In a short grid cell that overflows and is clipped — the
   bottom input row can't be seen or scrolled to — and FitAddon then reads the
   un-shrunk height and never reduces the rows. min-height:0 lets it shrink so
   fit() can size the terminal to the cell. */
.terminal-container {
  flex: 1;
  min-height: 0;
  padding: 4px;
}

.terminal-container.drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}
</style>
