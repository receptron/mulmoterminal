<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch, nextTick } from "vue";
import { type ITheme } from "@xterm/xterm";
import { FLIP_MS, shouldRefocusOnZoomChange } from "./cellFlip";
import { terminalManagesAttention, terminalViewActive } from "./terminalViewActive";
import { dragCarriesFiles, dropTextFromUriList, toInsertText } from "./dropPaths";
import { dropUploadErrorMessage, uploadDropBatch } from "./dropUpload";
import { translateUiSentence } from "../utils/translateUi";
import { useTheme, currentTermTheme, termThemeFor } from "../composables/useTheme";
import { useDirConfig } from "../composables/useDirConfig";
import { useTerminalFontSize } from "../composables/useTerminalFontSize";
import { globalFontFamily } from "../composables/terminalFontFamily";
import { badgeStyleFor } from "./dirBadge";
import { terminalHeaderStyleFor } from "./cellHeaderStyle";
import { useVoiceInput } from "../composables/useVoiceInput";
import { useGitStatus } from "../composables/useGitStatus";
import * as conn from "../composables/useTerminalConnections";
import { terminalAgent } from "../../common/sessionAgent";
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
// `runMenu` adds a Run dropdown to the header (the single view) that lists the
// open project's script.json and emits the picked command for the parent to run,
// plus a Skill dropdown that lists the project's .claude/skills and invokes the
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
  // A first-class antigravity session — connects to /ws/antigravity.
  antigravity?: boolean;
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
  // The CANVAS side of <cwd>/.mulmoterminal.json — palette, font — is NOT a prop: this
  // component resolves it from its own cwd (see `dirConfig` below). It used to arrive as four
  // props, and four separate hosts each had to remember to pass them; two didn't, so a shell
  // cell silently ignored every directory setting (#902). The header props below stay, because
  // the CHROME around the terminal is the host's to style, not this component's.
  //
  // Which directory to read that from, for a host whose `cwd` is deliberately unset (the single
  // view). Only a starting hint — the server-confirmed cwd wins as soon as it is known.
  dirCwd?: string | null;
  dirName?: string | null;
  dirBadgeColor?: string | null;
  // The header row's own colors (matches the grid cell's row-1 header): background,
  // text, and the icon buttons. Hex #rrggbb or null for the theme default.
}>();
const emit = defineEmits<{
  (e: "session" | "cwd", value: string): void;
  (e: "exit", exitCode: number | null): void;
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
    antigravity: !!props.antigravity,
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

// This terminal's directory settings, resolved HERE rather than handed down (#909). Keyed on the
// server-confirmed cwd — better than a host's copy, since the server may have rejected the
// requested directory and started somewhere else. useDirConfig shares one fetch per cwd, so a host
// that also reads the config for its own chrome costs nothing extra.
//
// `dirCwd` covers the one host that cannot supply `cwd`: the single view leaves it unset on purpose
// (passing it would put `?cwd=` on the WebSocket and change what the server connects to), so
// without a hint its palette would resolve only once the session reports back — a visible flash of
// the app-wide theme first. Unlike the four style props this replaces, forgetting this one costs a
// moment's delay, not a silently dead setting.
const dirConfigCwd = computed(() => serverCwd.value ?? props.dirCwd ?? null);
const { config: dirConfig } = useDirConfig(dirConfigCwd);

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
  agent: computed(() => terminalAgent(props)),
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
    agent: terminalAgent(props),
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
const { fontSize } = useTerminalFontSize();

// A dir-pinned theme wins over the app-wide selection for this terminal's canvas,
// then per-key `colors` override on top (so a dir can tweak just the background
// without restating a whole palette).
function effectiveTermTheme(): ITheme {
  const { theme, colors } = dirConfig.value;
  const base = theme ? termThemeFor(theme) : currentTermTheme();
  return colors ? { ...base, ...colors } : base;
}

// Same precedence as the theme: a dir pin wins, otherwise the app-wide value — per-browser for
// the size (Settings), from config.json for the family.
function effectiveFont(): conn.TerminalFont {
  const { fontSize: dirSize, fontFamily: dirFamily } = dirConfig.value;
  return { size: dirSize ?? fontSize.value, family: dirFamily ?? globalFontFamily.value };
}
const dirBadgeStyle = computed(() => badgeStyleFor(props.dirBadgeColor));
// From this terminal's OWN dirConfig, like the theme and font above (#909). Handing these down as
// props is what left the Shell and Command cells uncoloured for three releases (#1006): a host
// that forgets one gets a silently dead setting, and nothing fails.
const headerStyle = computed(() => terminalHeaderStyleFor(dirConfig.value.headerColor, dirConfig.value.headerTextColor, dirConfig.value.buttonColor));

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
      onExit: (exitCode) => emit("exit", exitCode),
    },
    container,
    effectiveTermTheme(),
    effectiveFont(),
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
watch([themeId, () => dirConfig.value.theme, () => dirConfig.value.colors], () => {
  conn.setTheme(slotKey, effectiveTermTheme());
});

// The font, unlike the palette, changes the cell metrics — conn.setFont re-fits and pushes the
// new cols/rows to the PTY, so the ResizeObserver above is not what reacts here (the host element
// never resized; only what fits inside it did). `globalFontFamily` is in the list because it
// hydrates from /api/config asynchronously, so a terminal mounted before that lands is corrected
// here rather than staying on the built-in stack. The dir values are watched for the same reason:
// on a fresh load useDirConfig has nothing cached, so the terminal is BUILT with the app-wide font
// and the directory's arrives only once /api/dir-config resolves.
watch([fontSize, globalFontFamily, () => dirConfig.value.fontSize, () => dirConfig.value.fontFamily], () => {
  conn.setFont(slotKey, effectiveFont());
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
// explicit close-button close. Both delegate to the slot's durable runtime.
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
// (text/uri-list); the File object hides it.
//
// The path is preferred whenever the drag carries one: it names the user's own file, so
// editing it afterwards means editing the file they dropped rather than a copy. When it is
// withheld — Chrome always, and every browser when this page is open from another machine,
// where a local path would name nothing on the host — the bytes are sent instead and the copy's
// path is inserted. Only a drag carrying neither falls back to the hint.
function onDrop(e: DragEvent) {
  dragOver.value = false;
  const dt = e.dataTransfer;
  if (!dt || !dragCarriesFiles(dt.types)) return; // not a file drop — leave text drags alone
  e.preventDefault();
  const text = dropTextFromUriList(dt.getData("text/uri-list") || dt.getData("text/plain"));
  if (text) return insertText(text);
  const files = Array.from(dt.files);
  if (files.length) enqueueDrop(files);
  else showDropHint();
}

// Send each dropped file and insert the paths together, so a multi-file drop reads as one
// argument list rather than arriving a word at a time. Sequential on purpose: these are whole
// files, and several large ones at once would compete for the same upload.
const DROP_UPLOADING_EN = "Sending the dropped file to the terminal…";
// The path hint would send the user to the file picker, which cannot help when the problem is
// that nothing is running to receive the file.
const DROP_NO_SESSION_EN = "Start the terminal first — there's no session yet to send the file to.";
// A saved file belongs to the session it was uploaded for, which is the only one granted its
// directory — so a path from before a session change names something this terminal cannot read.
const DROP_SESSION_CHANGED_EN = "This terminal moved to a different session while the file was sending — drop it again.";
// How many batches are queued or in flight. A count rather than a flag because a second drop
// arriving mid-upload would otherwise have whichever finished first hide the indicator out from
// under the other.
const dropUploads = ref(0);
const dropUploading = computed(() => dropUploads.value > 0);
const dropUploadingText = ref(DROP_UPLOADING_EN);

// Batches are serialized, not run in parallel: two racing uploads insert their paths in
// COMPLETION order rather than the order they were dropped, so the terminal receives an
// argument list the user did not choose — and a fast small file overtakes a slow large one
// every time (found by Codex review).
let dropChain: Promise<void> = Promise.resolve();
function enqueueDrop(files: File[]) {
  dropUploads.value += 1;
  dropChain = dropChain
    .then(() => uploadAndInsert(files))
    // The chain has to survive a failure: a rejected link would silently swallow every batch
    // dropped after it, for as long as the terminal stays open.
    .catch((err) => console.error("[drop] could not send a dropped file", err))
    .finally(() => (dropUploads.value -= 1));
}

async function uploadAndInsert(files: File[]) {
  const session = props.sessionId;
  if (!session) return showDropMessage(DROP_NO_SESSION_EN);
  // Shown in English first and swapped when the (server-cached) translation lands, like the hint.
  void translateUiSentence(DROP_UPLOADING_EN, "mulmoterminal-ui").then((translated) => (dropUploadingText.value = translated));
  const outcome = await uploadDropBatch(session, files, () => props.sessionId);
  if (outcome.kind === "stale") return showDropMessage(DROP_SESSION_CHANGED_EN);
  if (outcome.kind === "failed") return showDropMessage(dropUploadErrorMessage(outcome.status));
  insertText(toInsertText(outcome.paths));
}

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer || !dragCarriesFiles(e.dataTransfer.types)) return;
  e.preventDefault(); // required for the drop event to fire
  dragOver.value = true;
}

// Shown when a drop could not be turned into a path — the browser withheld it and there were
// no bytes to send either, or the upload failed. Saying so beats leaving the failed drop
// looking like nothing happened. The no-bytes guidance depends on the header: point at the file
// picker only when it's actually present (buttons are configurable and it can be removed),
// otherwise fall back to advice that always holds.
const DROP_HINT_PICKER_EN = "This browser doesn't share a dropped file's path. Use the paperclip button in the header (Insert a file path) instead.";
const DROP_HINT_TYPE_EN = "This browser doesn't share a dropped file's path — type or paste the path instead.";
const dropHint = ref(false);
const dropHintText = ref("");
const DROP_HINT_MS = 6000;
let dropHintTimer: ReturnType<typeof setTimeout> | undefined;
async function showDropMessage(english: string) {
  dropHintText.value = english; // show immediately; the translation (server-cached) swaps in
  dropHint.value = true;
  clearTimeout(dropHintTimer);
  dropHintTimer = setTimeout(() => (dropHint.value = false), DROP_HINT_MS);
  const translated = await translateUiSentence(english, "mulmoterminal-ui");
  if (dropHint.value) dropHintText.value = translated; // ignore if it resolved after the hint hid
}
const showDropHint = () => showDropMessage(hasPickFileButton(headerButtons.value) ? DROP_HINT_PICKER_EN : DROP_HINT_TYPE_EN);
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
          <span v-else class="material-symbols-outlined text-[18px]" aria-hidden="true">{{ b.icon || "bolt" }}</span>
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
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">{{ voiceIcon() }}</span>
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
    <!-- A whole file is being sent, which on a large one is long enough that an unchanged
         screen reads as a drop that did nothing. -->
    <div
      v-if="dropUploading"
      class="pointer-events-none absolute bottom-3 left-1/2 z-20 flex max-w-[min(90%,560px)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-panel px-4 py-2.5 font-sans text-[13px] leading-[1.4] text-fg shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
      role="status"
    >
      <span class="material-symbols-outlined shrink-0 text-[18px]" aria-hidden="true">upload</span>
      <span>{{ dropUploadingText }}</span>
    </div>
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
