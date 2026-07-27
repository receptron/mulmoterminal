<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { MODAL_FOCUSABLE, trapTabKey } from "../utils/focusTrap";
import { useTheme } from "../composables/useTheme";
import { useTerminalFontSize } from "../composables/useTerminalFontSize";
import { useTerminalScrollSpeed } from "../composables/useTerminalScrollSpeed";
import { previewNotify } from "../composables/useAttentionSound";
import { useCost } from "../composables/useCost";
import { activeKeymap } from "../composables/activeKeymap";
import { keymapRows } from "./keymapLabels";
import { useGoogleLink } from "../composables/useGoogleLink";
import { VOICE_LANGUAGES, voiceLanguage } from "../composables/voiceLanguage";
import { fetchVoiceInputStatus } from "../composables/voiceModelStatus";
import { SELECT_CONTROL } from "./selectClasses";
import SettingsButton from "./SettingsButton.vue";
import SettingsField from "./SettingsField.vue";
import GuideLinks from "./GuideLinks.vue";
import DirConfigPreview from "./DirConfigPreview.vue";
import type { Launcher } from "./launchers";
import type { UserMcpServer } from "./userMcp";
import type { QuickCommand } from "../../common/quickCommands";
import { SESSION_AGENTS, type SessionAgent } from "../../common/sessionAgent";
import { PUSH_KINDS, type PushKind } from "../../common/pushKinds";
import { NOTIFY_KINDS, type NotifyKind } from "../../common/notifyKinds";
import { presetRef, SOUND_PRESETS } from "../../common/notifySounds";
import { customSoundLabel, isCustomSound, toggledKinds, withKindSound, type SoundMap } from "../composables/soundSettings";
import { canAddLauncher, canAddMcpServer, canAddQuickCommand, canAddRepo } from "./settingsValidators";
import { formatUsd } from "./formatUsd";
import { isRecord } from "../../common/isRecord";

const props = defineProps<{
  soundFile?: string | null;
  soundKinds?: NotifyKind[];
  sounds?: SoundMap;
  pushEnabled?: boolean;
  pushKinds?: PushKind[];
  prRepos?: string[];
  launchers?: Launcher[];
  quickCommands?: QuickCommand[];
  userMcpServers?: UserMcpServer[];
  cwd?: string | null;
  sessionId?: string | null;
  // Directories to offer a config preview for: the recent-dir presets, plus the focused
  // session's own directory when it isn't one of them yet.
  dirPaths?: string[];
}>();
const emit = defineEmits<{
  (e: "update-sound", file: string | null): void;
  (e: "update-sound-kinds", kinds: NotifyKind[]): void;
  (e: "update-sounds", sounds: SoundMap): void;
  (e: "update-push-enabled", on: boolean): void;
  (e: "update-push-kinds", kinds: PushKind[]): void;
  (e: "update-repos", repos: string[]): void;
  (e: "update-launchers", launchers: Launcher[]): void;
  (e: "update-quick-commands", commands: QuickCommand[]): void;
  (e: "update-user-mcp", servers: UserMcpServer[]): void;
  (e: "configure-appearance" | "close"): void;
}>();

// Cross-repo PR view's repos ("owner/repo"). Editable list mirroring the saved value;
// add/remove emits the new list up (App persists it).
const repos = ref<string[]>([...(props.prRepos ?? [])]);
watch(
  () => props.prRepos,
  (r) => (repos.value = [...(r ?? [])]),
);
const newRepo = ref("");
const newRepoValid = computed(() => canAddRepo(newRepo.value, repos.value));
function addRepo() {
  const r = newRepo.value.trim();
  if (!newRepoValid.value) return;
  repos.value = [...repos.value, r];
  newRepo.value = "";
  emit("update-repos", repos.value);
}
function removeRepo(r: string) {
  repos.value = repos.value.filter((x) => x !== r);
  emit("update-repos", repos.value);
}

// Cell-launcher commands (label + command). Editable list mirroring the saved value;
// add/remove emits the new list up (App persists it).
const launcherList = ref<Launcher[]>([...(props.launchers ?? [])]);
watch(
  () => props.launchers,
  (l) => (launcherList.value = [...(l ?? [])]),
);
const newLauncherLabel = ref("");
const newLauncherCommand = ref("");
const newLauncherValid = computed(() => canAddLauncher(newLauncherLabel.value, newLauncherCommand.value, launcherList.value));
function addLauncher() {
  const label = newLauncherLabel.value.trim();
  const command = newLauncherCommand.value.trim();
  if (!newLauncherValid.value) return;
  launcherList.value = [...launcherList.value, { label, command }];
  newLauncherLabel.value = "";
  newLauncherCommand.value = "";
  emit("update-launchers", launcherList.value);
}
function removeLauncher(label: string) {
  launcherList.value = launcherList.value.filter((l) => l.label !== label);
  emit("update-launchers", launcherList.value);
}

// Phrases the phone offers as chips on a session (#830). Same editable-mirror shape as the
// lists above; `agents` scopes an entry to session kinds, and selecting none means every kind.
const quickCommandList = ref<QuickCommand[]>([...(props.quickCommands ?? [])]);
watch(
  () => props.quickCommands,
  (c) => (quickCommandList.value = [...(c ?? [])]),
);
const newQuickLabel = ref("");
const newQuickText = ref("");
const newQuickAgents = ref<SessionAgent[]>([]);
const newQuickValid = computed(() => canAddQuickCommand(newQuickLabel.value, newQuickText.value, quickCommandList.value));

function toggleNewQuickAgent(agent: SessionAgent) {
  newQuickAgents.value = newQuickAgents.value.includes(agent) ? newQuickAgents.value.filter((a) => a !== agent) : [...newQuickAgents.value, agent];
}

function addQuickCommand() {
  if (!newQuickValid.value) return;
  const label = newQuickLabel.value.trim();
  const text = newQuickText.value.trim();
  // Omit `agents` rather than send [] — the server reads an empty list as "every kind" too,
  // but leaving the key out is what the config format documents for "unscoped".
  const agents = newQuickAgents.value.length ? [...newQuickAgents.value] : undefined;
  quickCommandList.value = [...quickCommandList.value, agents ? { label, text, agents } : { label, text }];
  newQuickLabel.value = "";
  newQuickText.value = "";
  newQuickAgents.value = [];
  emit("update-quick-commands", quickCommandList.value);
}

function removeQuickCommand(label: string) {
  quickCommandList.value = quickCommandList.value.filter((c) => c.label !== label);
  emit("update-quick-commands", quickCommandList.value);
}

const agentScopeLabel = (command: QuickCommand): string => (command.agents?.length ? command.agents.join(" / ") : "all");

// User HTTP MCP servers (id + url) merged into the single-view Claude session. Editable
// list mirroring the saved value; add/remove emits the new list up.
const mcpServers = ref<UserMcpServer[]>([...(props.userMcpServers ?? [])]);
watch(
  () => props.userMcpServers,
  (s) => (mcpServers.value = [...(s ?? [])]),
);
const newMcpId = ref("");
const newMcpUrl = ref("");
const newMcpValid = computed(() => canAddMcpServer(newMcpId.value, newMcpUrl.value, mcpServers.value));
function addMcpServer() {
  const id = newMcpId.value.trim();
  const url = newMcpUrl.value.trim();
  if (!newMcpValid.value) return;
  mcpServers.value = [...mcpServers.value, { id, url }];
  newMcpId.value = "";
  newMcpUrl.value = "";
  emit("update-user-mcp", mcpServers.value);
}
function removeMcpServer(id: string) {
  mcpServers.value = mcpServers.value.filter((s) => s.id !== id);
  emit("update-user-mcp", mcpServers.value);
}

// Custom attention sound, applied immediately (like the theme) — empty => the
// built-in chime. The text box mirrors the saved value; Browse / typing apply it.
const soundPath = ref(props.soundFile ?? "");
watch(
  () => props.soundFile,
  (f) => (soundPath.value = f ?? ""),
);

function applySound() {
  emit("update-sound", soundPath.value.trim() || null);
}
function clearSound() {
  soundPath.value = "";
  emit("update-sound", null);
}
// Web Push toggle — stateless: reflects props.pushEnabled, emits the new value up (App persists it).
function onPushToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) emit("update-push-enabled", e.target.checked);
}

// Which kinds of push to send (#850). The master toggle above says whether to notify at all;
// this says which moments qualify, so a user who only wants finished turns can decline the ones
// a blocked agent raises. Editable list mirroring the saved value, like the other lists here.
const PUSH_KIND_LABEL: Record<PushKind, string> = { finished: "Turn finished", waiting: "Waiting for you" };
const PUSH_KIND_HELP: Record<PushKind, string> = {
  finished: "the agent replied and the output is unread",
  waiting: "it stopped to ask — a permission prompt or a question. Fires once per prompt, so a task that asks a lot pushes a lot",
};
const pushKindList = ref<PushKind[]>([...(props.pushKinds ?? [])]);
watch(
  () => props.pushKinds,
  (k) => (pushKindList.value = [...(k ?? [])]),
);
function togglePushKind(kind: PushKind) {
  // Emitted in PUSH_KINDS order so the saved list reads the same however it was clicked.
  const next = pushKindList.value.includes(kind) ? pushKindList.value.filter((k) => k !== kind) : [...pushKindList.value, kind];
  pushKindList.value = PUSH_KINDS.filter((k) => next.includes(k));
  emit("update-push-kinds", pushKindList.value);
}
async function browseSound() {
  try {
    const res = await fetch("/api/pick-file", { method: "POST", headers: { "content-type": "application/json" } });
    if (!res.ok) return;
    const data: unknown = await res.json();
    const picked = isRecord(data) && Array.isArray(data.paths) && typeof data.paths[0] === "string" ? data.paths[0] : "";
    if (picked) {
      soundPath.value = picked;
      applySound();
    }
  } catch {
    // native dialog unavailable / canceled — leave the field as-is
  }
}
// Which moments beep, and what each one plays (#873). Same shape as the push kinds above:
// the toolbar's speaker icon says whether to beep at all, this says which moments qualify.
const NOTIFY_KIND_LABEL: Record<NotifyKind, string> = {
  finished: "Turn finished",
  waiting: "Waiting for you",
  "command-done": "Command finished",
  "command-failed": "Command failed",
  "session-exited": "Session ended",
  "pr-ci-failed": "PR CI failed",
};
const NOTIFY_KIND_HELP: Record<NotifyKind, string> = {
  finished: "the agent replied and the output is unread",
  waiting: "it stopped to ask — a permission prompt or a question",
  "command-done": "a Run cell's command exited cleanly",
  "command-failed": "a Run cell's command exited with an error, or never started",
  "session-exited": "a session's terminal ended — including when you close the cell yourself",
  "pr-ci-failed": "a directory's PR went red. Only seen while the roster is on screen, since that is what polls it",
};

const soundKindList = ref<NotifyKind[]>([...(props.soundKinds ?? [])]);
watch(
  () => props.soundKinds,
  (k) => (soundKindList.value = [...(k ?? [])]),
);
function toggleSoundKind(kind: NotifyKind) {
  soundKindList.value = toggledKinds(soundKindList.value, kind);
  emit("update-sound-kinds", soundKindList.value);
}

// Editable mirror of the saved map, like the lists above. It has to be a LOCAL ref and not
// `props.sounds`: the whole map is persisted on every change, so two picks made before the
// first POST answers would both compute from the same pre-save snapshot and the second would
// drop the first. This is the hazard createPresetMutations serializes writes for.
const soundMap = ref<SoundMap>({ ...(props.sounds ?? {}) });
watch(
  () => props.sounds,
  (m) => (soundMap.value = { ...(m ?? {}) }),
);

// "" is the fallback (the file below, else the chime). A kind whose saved value is a PATH —
// only settable by hand in config.json — gets an extra option so picking a preset for another
// kind can't silently drop it. The editing itself is pure, in composables/soundSettings.
const soundValue = (kind: NotifyKind): string => soundMap.value[kind] ?? "";
function setKindSound(kind: NotifyKind, value: string) {
  soundMap.value = withKindSound(soundMap.value, kind, value);
  emit("update-sounds", soundMap.value);
}
function onKindSoundChange(kind: NotifyKind, e: Event) {
  if (e.target instanceof HTMLSelectElement) setKindSound(kind, e.target.value);
}
// Preview what this kind would play, resolved the same way a real beep resolves it (the kind's
// own sound, else the fallback file, else the chime). Reads the LOCAL map so a preset picked a
// moment ago is what you hear — a preset is fetched by id and needs no saved config. Falling
// back to `soundFile` still shows the saved path, which is the only value the server can stream.
function testKindSound(kind: NotifyKind) {
  void previewNotify(kind, { kinds: soundKindList.value, sounds: soundMap.value, soundFile: props.soundFile ?? null });
}

// Theme is applied immediately on click.
const { themeId, themes, setTheme } = useTheme();
const themesEl = ref<HTMLElement>();

// Terminal font size, applied immediately (like the theme). Per-browser, so a phone and a
// desktop on the same server keep their own; a directory can pin its own in .mulmoterminal.json.
const { fontSize, nudgeFontSize, min: fontSizeMin, max: fontSizeMax, step: fontSizeStep } = useTerminalFontSize();

// Terminal scroll speed, same shape and the same per-browser reasoning as the font size: it is a
// property of the pointing device, and a trackpad and a wheel mouse want different answers.
const { scrollSpeed, nudgeScrollSpeed, min: scrollSpeedMin, max: scrollSpeedMax, step: scrollSpeedStep } = useTerminalScrollSpeed();

// Google account link. The modal is v-if'd, so a fresh load on mount also picks up
// out-of-band changes (`mulmoterminal google login`, a deleted token file).
const {
  status: googleStatus,
  busy: googleBusy,
  error: googleError,
  refresh: refreshGoogle,
  connect: connectGoogle,
  unlink: unlinkGoogle,
  dispose: disposeGoogle,
} = useGoogleLink();

const googleStatusText = computed(() => {
  if (!googleStatus.value) return "Checking…";
  if (googleStatus.value.pending) return "Waiting for consent in your browser…";
  return googleStatus.value.linked ? "Linked" : "Not linked";
});

// Broker (GCP settings-free link) removes the client secret requirement. When a broker is available,
// consent can flow through it; otherwise, a Desktop client's secret on disk is needed.
const googleSecretHint = computed(() => {
  if (googleStatus.value?.brokerAvailable) return "";
  const presence = googleStatus.value?.clientSecret;
  if (presence === "missing")
    return "No OAuth client secret found in ~/.secrets. Add a Desktop client's client_secret_*.json there to enable sign-in, or use the GCP-settings-free broker link if available.";
  if (presence === "ambiguous") return "Multiple client_secret_*.json files in ~/.secrets — keep exactly one.";
  return "";
});

async function onUnlinkGoogle() {
  if (!window.confirm("Unlink this Google account? MulmoTerminal will lose Calendar access until you sign in again.")) return;
  await unlinkGoogle();
}

// ARIA radiogroup keyboard contract: arrows move selection (and focus) within
// the group, wrapping at the ends; only the checked radio is tabbable (roving
// tabindex), so Tab enters/leaves the group as one stop.
function onThemeKey(e: KeyboardEvent, index: number) {
  const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
  const backward = e.key === "ArrowLeft" || e.key === "ArrowUp";
  if (!forward && !backward) return;
  e.preventDefault();
  const next = (index + (forward ? 1 : themes.length - 1)) % themes.length;
  setTheme(themes[next].id);
  themesEl.value?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}

// Voice input's language mode. The setting is a singleton ref (localStorage-backed), so it
// needs no prop/emit plumbing — but the section is only worth showing on a machine that can
// transcribe at all, and capability lives on the server. One cheap GET when the modal opens;
// a failed/absent probe leaves the section hidden rather than offering a setting for a mic
// that will never appear.
const voiceCapable = ref(false);
async function refreshVoiceCapable() {
  voiceCapable.value = (await fetchVoiceInputStatus())?.capable ?? false;
}

// Read-only estimated cost (Session / Today / Month), loaded when the modal opens.
const { cost, error: costError, load: loadCost } = useCost();

// Reactive, not a snapshot: /api/config is fetched asynchronously, so a modal opened before it
// lands would otherwise sit on "Not set" for every action until it is closed and reopened.
const shortcutRows = computed(() => keymapRows(activeKeymap.value));

const modalEl = ref<HTMLElement>();

// Modal keyboard behavior: Escape closes; Tab is trapped within the dialog.
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
    return;
  }
  if (e.key !== "Tab" || !modalEl.value) return;
  trapTabKey(e, modalEl.value, MODAL_FOCUSABLE);
}

// Load cost unconditionally — the server falls back to the workspace when no cwd is
// passed, so Today/Month still populate in the grid view (no active single-view
// session ⇒ no cwd/sessionId). Re-fetch if cwd/sessionId arrive or change while open.
const refreshCost = () => loadCost(props.cwd ?? null, props.sessionId ?? null);
onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  nextTick(() => modalEl.value?.querySelector<HTMLElement>("input, button")?.focus());
  refreshCost();
  refreshGoogle();
  refreshVoiceCapable();
});
watch([() => props.cwd, () => props.sessionId], refreshCost);
onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
  disposeGoogle();
});
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(0,0,0,0.55)]" @click.self="emit('close')">
    <div
      ref="modalEl"
      class="flex max-h-[85vh] w-[min(560px,92vw)] flex-col overflow-y-auto rounded-[10px] border border-border bg-base p-4 font-sans text-fg"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-semibold">Settings</h2>
        <button
          class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
          title="Close"
          aria-label="Close settings"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Theme</h3>
      <div ref="themesEl" class="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
        <button
          v-for="(t, i) in themes"
          :key="t.id"
          type="button"
          class="flex w-[84px] cursor-pointer flex-col items-center gap-1.5 rounded-lg border bg-elevated p-2 hover:bg-hover"
          :class="themeId === t.id ? 'border-accent text-fg' : 'border-border text-muted hover:text-fg'"
          role="radio"
          :aria-checked="themeId === t.id"
          :tabindex="themeId === t.id ? 0 : -1"
          :title="t.label"
          @click="setTheme(t.id)"
          @keydown="onThemeKey($event, i)"
        >
          <span class="relative h-[34px] w-full overflow-hidden rounded-md border border-border" :style="{ background: t.swatch.base }">
            <span class="absolute bottom-1.5 left-2 h-3 w-3 rounded-full" :style="{ background: t.swatch.panel }" />
            <span class="absolute bottom-1.5 left-6 h-3 w-3 rounded-full" :style="{ background: t.swatch.accent }" />
          </span>
          <span class="text-[12px]">{{ t.label }}</span>
        </button>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Terminal font size</h3>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-elevated text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="fontSize <= fontSizeMin"
          aria-label="Decrease terminal font size"
          @click="nudgeFontSize(-fontSizeStep)"
        >
          −
        </button>
        <span class="min-w-[56px] text-center text-[13px] text-fg" aria-live="polite">{{ fontSize }} px</span>
        <button
          type="button"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-elevated text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="fontSize >= fontSizeMax"
          aria-label="Increase terminal font size"
          @click="nudgeFontSize(fontSizeStep)"
        >
          +
        </button>
      </div>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Applies to every terminal on this browser. A directory can pin its own with <code>fontSize</code> in its <code>.mulmoterminal.json</code>.
      </p>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Terminal scroll speed</h3>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-elevated text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="scrollSpeed <= scrollSpeedMin"
          aria-label="Decrease terminal scroll speed"
          @click="nudgeScrollSpeed(-scrollSpeedStep)"
        >
          −
        </button>
        <span class="min-w-[56px] text-center text-[13px] text-fg" aria-live="polite">{{ scrollSpeed }}×</span>
        <button
          type="button"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-elevated text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="scrollSpeed >= scrollSpeedMax"
          aria-label="Increase terminal scroll speed"
          @click="nudgeScrollSpeed(scrollSpeedStep)"
        >
          +
        </button>
      </div>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        How far one wheel notch or trackpad swipe moves the terminal — 1× is the default. Lower it if a two-finger scroll on a Mac trackpad flies past what you
        were reading. Per browser, and it covers both a shell's scrollback and a full-screen app like Claude Code.
      </p>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Directory appearance</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Launch the <code>mulmoterminal-config</code> skill to style a directory — name badge, colors, terminal palette, header buttons. It configures the
        focused session's directory, or lets you pick from your recent directories.
      </p>
      <SettingsButton @click="emit('configure-appearance')"
        ><span class="material-symbols-outlined" aria-hidden="true">palette</span> Configure appearance…</SettingsButton
      >

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Directory settings</h3>
      <p class="mb-1 mt-1.5 text-[12px] text-dim">
        What each directory's <code>.mulmoterminal.json</code> is actually doing. Expand one to see the values in force, and any key the app dropped or doesn't
        recognise — a setting that never took effect looks the same as one you never made until you can see this.
      </p>
      <DirConfigPreview :paths="dirPaths ?? []" />

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Notification sounds</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Which moments beep, and what each one plays. Running many agents at once is what turns notifications into noise — untick the ones you don't need. The
        speaker button in the toolbar silences all of them at once.
      </p>
      <div v-for="kind in NOTIFY_KINDS" :key="kind" class="py-0.5">
        <div class="flex items-center gap-2">
          <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              class="shrink-0 cursor-pointer"
              :checked="soundKindList.includes(kind)"
              :aria-label="`Beep when a session is ${kind}`"
              @change="toggleSoundKind(kind)"
            />
            <span class="truncate text-[12px]"
              ><strong>{{ NOTIFY_KIND_LABEL[kind] }}</strong></span
            >
          </label>
          <!-- The width lives on this wrapper, not the select: SELECT_CONTROL is `w-full`, and a
               `w-44` beside it is the same specificity — which of the two wins is decided by the
               order Tailwind emits them, not by the order written here. -->
          <div class="w-36 shrink-0">
            <select
              :value="soundValue(kind)"
              :disabled="!soundKindList.includes(kind)"
              :aria-label="`Sound for ${NOTIFY_KIND_LABEL[kind]}`"
              :class="SELECT_CONTROL"
              class="truncate"
              @change="onKindSoundChange(kind, $event)"
            >
              <option value="">Default</option>
              <option v-for="preset in SOUND_PRESETS" :key="preset.id" :value="presetRef(preset.id)">{{ preset.label }}</option>
              <option v-if="isCustomSound(soundValue(kind))" :value="soundValue(kind)">{{ customSoundLabel(soundValue(kind)) }}</option>
            </select>
          </div>
          <SettingsButton class="shrink-0" :title="`Play the ${NOTIFY_KIND_LABEL[kind]} sound`" @click="testKindSound(kind)"
            ><span class="material-symbols-outlined" aria-hidden="true">play_arrow</span></SettingsButton
          >
        </div>
        <p class="ml-6 text-[11px] text-dim">{{ NOTIFY_KIND_HELP[kind] }}</p>
      </div>

      <p class="mb-1.5 mt-3 text-[12px] text-dim">
        <strong>Default</strong> plays your own file below, or the built-in chime when that is empty. The presets are fetched once and kept on this machine, so
        they keep working offline.
      </p>
      <div class="flex items-center gap-2">
        <SettingsField
          v-model="soundPath"
          class="flex-auto font-mono"
          placeholder="/absolute/path/to/sound.wav"
          aria-label="Custom notification sound file"
          spellcheck="false"
          @change="applySound"
        />
        <SettingsButton @click="browseSound">Browse…</SettingsButton>
        <SettingsButton :disabled="!soundPath" title="Use the built-in chime" @click="clearSound">Use chime</SettingsButton>
      </div>

      <template v-if="voiceCapable">
        <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Voice input</h3>
        <p class="mb-3 mt-1.5 text-[12px] text-dim">
          The language you dictate in. Speaking a language the mic is not expecting comes back <strong>translated</strong> into the expected one — so pick the
          one you actually speak rather than leaving it on your browser's.
        </p>
        <select v-model="voiceLanguage" aria-label="Language for voice input" :class="SELECT_CONTROL">
          <option value="locale">My browser's language</option>
          <option value="auto">Detect from what I say</option>
          <optgroup label="Always this language">
            <option v-for="lang in VOICE_LANGUAGES" :key="lang.code" :value="lang.code">{{ lang.label }}</option>
          </optgroup>
        </select>
      </template>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Web Push notifications</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Send a push to your registered devices when a background task finishes. Requires the <strong>RemoteHost</strong> connection — its sign-in provides the
        notification auth, so pushes only send while it's connected.
      </p>
      <label class="flex cursor-pointer items-center gap-2">
        <input type="checkbox" class="cursor-pointer" :checked="props.pushEnabled ?? false" aria-label="Send a Web Push to my devices" @change="onPushToggle" />
        <span>Notify my devices</span>
      </label>
      <div class="mt-2.5" :class="pushEnabled ? '' : 'pointer-events-none opacity-50'">
        <p class="mb-1.5 text-[12px] text-dim">Which moments are worth a push:</p>
        <label v-for="kind in PUSH_KINDS" :key="kind" class="flex cursor-pointer items-start gap-2 py-0.5">
          <input
            type="checkbox"
            class="mt-1 cursor-pointer"
            :checked="pushKindList.includes(kind)"
            :disabled="!pushEnabled"
            :aria-label="`Push when a session is ${kind}`"
            @change="togglePushKind(kind)"
          />
          <span class="text-[12px]">
            <strong>{{ PUSH_KIND_LABEL[kind] }}</strong> — {{ PUSH_KIND_HELP[kind] }}
          </span>
        </label>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Google account</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Link a Google account so the <code>google</code> tool and your phone can read and create <strong>Calendar</strong> events. Sign-in opens in a new tab
        and finishes on <strong>this machine</strong>, so use a browser here — over a remote connection, run
        <code>npx mulmoterminal google login</code> instead. The link is shared with MulmoClaude.
      </p>
      <p v-if="googleSecretHint" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-err-text">{{ googleSecretHint }}</p>
      <div class="mb-3 flex items-center gap-2.5">
        <span class="text-[12px]" :class="googleStatus?.linked ? 'text-ok' : 'text-muted'">{{ googleStatusText }}</span>
        <SettingsButton
          v-if="!googleStatus?.linked"
          :disabled="googleBusy || googleStatus?.pending || (googleStatus?.clientSecret !== 'found' && !googleStatus?.brokerAvailable)"
          @click="connectGoogle"
        >
          Sign in with Google
        </SettingsButton>
        <SettingsButton v-else :disabled="googleBusy" @click="onUnlinkGoogle">Unlink</SettingsButton>
      </div>
      <p v-if="googleError" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-err-text" role="alert">{{ googleError }}</p>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Pull request repos</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Repos whose open PRs the cross-repo <strong>Pull requests</strong> view lists. Uses your <code>gh</code> login. Format: <code>owner/repo</code>.
      </p>
      <ul v-if="repos.length" class="m-0 mb-2 flex list-none flex-col gap-1 p-0">
        <li v-for="r in repos" :key="r" class="flex items-center gap-2 rounded-md border border-border bg-elevated py-1 pl-2.5 pr-1.5">
          <span class="flex-auto font-mono text-[12px] text-secondary">{{ r }}</span>
          <button
            class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
            type="button"
            :title="`Remove ${r}`"
            :aria-label="`Remove ${r}`"
            @click="removeRepo(r)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </li>
      </ul>
      <div class="flex items-center gap-2">
        <SettingsField
          v-model="newRepo"
          class="flex-auto font-mono"
          placeholder="owner/repo"
          aria-label="Add a repository (owner/repo)"
          spellcheck="false"
          @keydown.enter="addRepo"
        />
        <SettingsButton :disabled="!newRepoValid" @click="addRepo">Add</SettingsButton>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Launch commands</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Programs a grid cell can launch besides Claude — a plain shell, <code>codex</code>, any interactive command. They run in the cell's directory as a
        persistent terminal. Example: <code>Shell</code> → <code>$SHELL</code>, <code>Codex</code> → <code>codex</code>.
      </p>
      <ul v-if="launcherList.length" class="m-0 mb-2 flex list-none flex-col gap-1 p-0">
        <li v-for="l in launcherList" :key="l.label" class="flex items-center gap-2 rounded-md border border-border bg-elevated py-1 pl-2.5 pr-1.5">
          <span class="flex-auto font-mono text-[12px] text-secondary">{{ l.label }}</span>
          <code class="min-w-0 flex-auto truncate font-mono text-[11px] text-dim">{{ l.command }}</code>
          <button
            class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
            type="button"
            :title="`Remove ${l.label}`"
            :aria-label="`Remove ${l.label}`"
            @click="removeLauncher(l.label)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </li>
      </ul>
      <div class="flex items-center gap-2">
        <SettingsField
          v-model="newLauncherLabel"
          class="min-w-0 shrink grow basis-[30%]"
          placeholder="Label"
          aria-label="Launcher label"
          spellcheck="false"
          @keydown.enter="addLauncher"
        />
        <SettingsField
          v-model="newLauncherCommand"
          class="min-w-0 flex-auto font-mono"
          placeholder="command (e.g. $SHELL)"
          aria-label="Launcher command"
          spellcheck="false"
          @keydown.enter="addLauncher"
        />
        <SettingsButton :disabled="!newLauncherValid" @click="addLauncher">Add</SettingsButton>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Phone quick commands</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Phrases you send often, offered as chips on the phone's terminal view. Tapping one puts the text in the input box — it isn't sent until you press send.
        The label is the chip's face, so keep it short. Example: <code>PR</code> → <code>PR作って</code>. Leave every kind unchecked to offer a command
        everywhere, or tick the ones it suits — <code>git status</code> belongs to a shell, not to Claude.
      </p>
      <ul v-if="quickCommandList.length" class="m-0 mb-2 flex list-none flex-col gap-1 p-0">
        <li v-for="c in quickCommandList" :key="c.label" class="flex items-center gap-2 rounded-md border border-border bg-elevated py-1 pl-2.5 pr-1.5">
          <span class="flex-none font-mono text-[12px] text-secondary">{{ c.label }}</span>
          <code class="min-w-0 flex-auto truncate font-mono text-[11px] text-dim">{{ c.text }}</code>
          <span class="flex-none rounded-sm bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-muted">{{ agentScopeLabel(c) }}</span>
          <button
            class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
            type="button"
            :title="`Remove ${c.label}`"
            :aria-label="`Remove ${c.label}`"
            @click="removeQuickCommand(c.label)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </li>
      </ul>
      <div class="flex items-center gap-2">
        <SettingsField
          v-model="newQuickLabel"
          class="min-w-0 shrink grow basis-[25%]"
          placeholder="Label"
          aria-label="Quick command label"
          spellcheck="false"
          @keydown.enter="addQuickCommand"
        />
        <SettingsField
          v-model="newQuickText"
          class="min-w-0 flex-auto"
          placeholder="text to insert (e.g. PR作って)"
          aria-label="Quick command text"
          spellcheck="false"
          @keydown.enter="addQuickCommand"
        />
        <SettingsButton :disabled="!newQuickValid" @click="addQuickCommand">Add</SettingsButton>
      </div>
      <div class="mt-1.5 flex items-center gap-3">
        <span class="text-[11px] text-muted">Offer to:</span>
        <label v-for="agent in SESSION_AGENTS" :key="agent" class="flex cursor-pointer items-center gap-1 text-[11px] text-dim">
          <input
            type="checkbox"
            class="cursor-pointer"
            :checked="newQuickAgents.includes(agent)"
            :aria-label="`Offer to ${agent} sessions`"
            @change="toggleNewQuickAgent(agent)"
          />
          <span class="font-mono">{{ agent }}</span>
        </label>
        <span class="text-[11px] text-muted">(none ticked = every kind)</span>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">MCP servers</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        HTTP MCP servers the <strong>single-view</strong> Claude session loads (in addition to the built-in GUI tools). <code>id</code> is the server name;
        <code>url</code> is its streamable-HTTP endpoint. In the Docker sandbox, a <code>localhost</code> URL is reached over <code>host.docker.internal</code>
        automatically. Takes effect on the next Claude session.
      </p>
      <ul v-if="mcpServers.length" class="m-0 mb-2 flex list-none flex-col gap-1 p-0">
        <li v-for="s in mcpServers" :key="s.id" class="flex items-center gap-2 rounded-md border border-border bg-elevated py-1 pl-2.5 pr-1.5">
          <span class="flex-auto font-mono text-[12px] text-secondary">{{ s.id }}</span>
          <code class="min-w-0 flex-auto truncate font-mono text-[11px] text-dim">{{ s.url }}</code>
          <button
            class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
            type="button"
            :title="`Remove ${s.id}`"
            :aria-label="`Remove ${s.id}`"
            @click="removeMcpServer(s.id)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </li>
      </ul>
      <div class="flex items-center gap-2">
        <SettingsField
          v-model="newMcpId"
          class="min-w-0 shrink grow basis-[30%]"
          placeholder="id (e.g. weather)"
          aria-label="MCP server id"
          spellcheck="false"
          @keydown.enter="addMcpServer"
        />
        <SettingsField
          v-model="newMcpUrl"
          class="min-w-0 flex-auto font-mono"
          placeholder="https://… or http://localhost:PORT/mcp"
          aria-label="MCP server URL"
          spellcheck="false"
          @keydown.enter="addMcpServer"
        />
        <SettingsButton :disabled="!newMcpValid" @click="addMcpServer">Add</SettingsButton>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Cost (estimated)</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Estimated spend for this project from <strong>public per-model pricing</strong> (input, output, and cache tokens) — actual billing may differ, and
        flat-plan (Max) usage isn't reflected. Today / Month roll up this project's sessions.
      </p>
      <div class="flex gap-2" role="group" aria-label="Estimated cost" title="Estimated from public per-model pricing; actual billing may differ.">
        <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
          <span class="text-[11px] uppercase tracking-[0.04em] text-muted">Session</span>
          <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.session) }}</span>
        </div>
        <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
          <span class="text-[11px] uppercase tracking-[0.04em] text-muted">Today</span>
          <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.today) }}</span>
        </div>
        <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
          <span class="text-[11px] uppercase tracking-[0.04em] text-muted">Month</span>
          <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.month) }}</span>
        </div>
      </div>
      <p v-if="costError" class="mt-2 text-[12px] text-dim">Couldn't load cost estimate.</p>
      <p v-else-if="cost && (cost.unpricedTurns > 0 || cost.sessionUnpricedTurns > 0)" class="mt-2 text-[12px] text-dim">
        Some turns used a model with no known price and are excluded from these estimates.
      </p>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Keyboard shortcuts</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Read-only. Shortcuts are off until you bind them in <code>~/.mulmoterminal/config.json</code> under <code>keymap</code> — every key you bind stops
        reaching the program inside the terminal. Ask <code>/mulmoterminal-config</code> to set them up, or see the
        <a class="text-accent underline" href="https://receptron.github.io/mulmoterminal/guide/en/config.html#keymap" target="_blank" rel="noopener noreferrer"
          >guide</a
        >.
      </p>
      <div class="flex flex-col gap-1" role="list" aria-label="Keyboard shortcuts">
        <div
          v-for="row in shortcutRows"
          :key="row.action"
          role="listitem"
          class="flex items-center gap-2 rounded-md border border-border bg-elevated px-2.5 py-1.5"
        >
          <span class="min-w-0 flex-1 truncate text-[12px] text-fg">{{ row.label }}</span>
          <code v-if="row.binding" class="shrink-0 rounded border border-border bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg">{{ row.binding }}</code>
          <span v-else class="shrink-0 text-[11px] text-muted">Not set</span>
          <code class="shrink-0 font-mono text-[10px] text-muted">{{ row.action }}</code>
        </div>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Help &amp; user guide</h3>
      <GuideLinks />

      <div class="mt-4 flex items-center gap-2">
        <span class="flex-1" />
        <SettingsButton primary @click="emit('close')">Close</SettingsButton>
      </div>
    </div>
  </div>
</template>
