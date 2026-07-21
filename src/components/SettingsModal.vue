<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { trapTabKey } from "../utils/focusTrap";
import { useTheme } from "../composables/useTheme";
import { previewAttention } from "../composables/useAttentionSound";
import { useCost } from "../composables/useCost";
import { useGoogleLink } from "../composables/useGoogleLink";
import SettingsButton from "./SettingsButton.vue";
import SettingsField from "./SettingsField.vue";
import type { Launcher } from "./launchers";
import type { UserMcpServer } from "./userMcp";

const props = defineProps<{
  soundFile?: string | null;
  pushEnabled?: boolean;
  prRepos?: string[];
  launchers?: Launcher[];
  userMcpServers?: UserMcpServer[];
  cwd?: string | null;
  sessionId?: string | null;
}>();
const emit = defineEmits<{
  (e: "update-sound", file: string | null): void;
  (e: "update-push-enabled", on: boolean): void;
  (e: "update-repos", repos: string[]): void;
  (e: "update-launchers", launchers: Launcher[]): void;
  (e: "update-user-mcp", servers: UserMcpServer[]): void;
  (e: "configure-appearance" | "close"): void;
}>();

// Cross-repo PR view's repos ("owner/repo"). Editable list mirroring the saved value;
// add/remove emits the new list up (App persists it).
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const repos = ref<string[]>([...(props.prRepos ?? [])]);
watch(
  () => props.prRepos,
  (r) => (repos.value = [...(r ?? [])]),
);
const newRepo = ref("");
const newRepoValid = computed(() => {
  const r = newRepo.value.trim();
  return REPO_RE.test(r) && !repos.value.includes(r);
});
function addRepo() {
  const r = newRepo.value.trim();
  if (!REPO_RE.test(r) || repos.value.includes(r)) return;
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
const newLauncherValid = computed(() => {
  const label = newLauncherLabel.value.trim();
  const command = newLauncherCommand.value.trim();
  return !!label && !!command && !launcherList.value.some((l) => l.label === label);
});
function addLauncher() {
  const label = newLauncherLabel.value.trim();
  const command = newLauncherCommand.value.trim();
  if (!label || !command || launcherList.value.some((l) => l.label === label)) return;
  launcherList.value = [...launcherList.value, { label, command }];
  newLauncherLabel.value = "";
  newLauncherCommand.value = "";
  emit("update-launchers", launcherList.value);
}
function removeLauncher(label: string) {
  launcherList.value = launcherList.value.filter((l) => l.label !== label);
  emit("update-launchers", launcherList.value);
}

// User HTTP MCP servers (id + url) merged into the single-view Claude session. Editable
// list mirroring the saved value; add/remove emits the new list up.
const MCP_ID_RE = /^[A-Za-z0-9_-]+$/;
const mcpServers = ref<UserMcpServer[]>([...(props.userMcpServers ?? [])]);
watch(
  () => props.userMcpServers,
  (s) => (mcpServers.value = [...(s ?? [])]),
);
const newMcpId = ref("");
const newMcpUrl = ref("");
const newMcpValid = computed(() => {
  const id = newMcpId.value.trim();
  const url = newMcpUrl.value.trim();
  return MCP_ID_RE.test(id) && /^https?:\/\/\S+$/.test(url) && !mcpServers.value.some((s) => s.id === id);
});
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
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

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
// Preview the SAVED sound (apply first via Browse / blur), so it plays the file the
// server actually serves at /api/sound; null plays the chime.
function testSound() {
  previewAttention(props.soundFile ?? null);
}

// Theme is applied immediately on click.
const { themeId, themes, setTheme } = useTheme();
const themesEl = ref<HTMLElement>();

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

// Read-only estimated cost (Session / Today / Month), loaded when the modal opens.
const { cost, error: costError, load: loadCost } = useCost();
function formatUsd(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

const modalEl = ref<HTMLElement>();

// Modal keyboard behavior: Escape closes; Tab is trapped within the dialog.
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
    return;
  }
  if (e.key !== "Tab" || !modalEl.value) return;
  trapTabKey(e, modalEl.value, 'button, input, [tabindex]:not([tabindex="-1"])');
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
          ✕
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

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Directory appearance</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Launch the <code>mulmoterminal-config</code> skill to style a directory — name badge, colors, terminal palette, header buttons. It configures the
        focused session's directory, or lets you pick from your recent directories.
      </p>
      <SettingsButton @click="emit('configure-appearance')">🎨 Configure appearance…</SettingsButton>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Notification sound</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Played when a session needs attention. Leave empty for the built-in chime, or point to your own audio file.
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
      </div>
      <div class="mt-2 flex gap-2">
        <SettingsButton title="Play the current sound" @click="testSound">▶ Test</SettingsButton>
        <SettingsButton :disabled="!soundPath" title="Use the built-in chime" @click="clearSound">Use chime</SettingsButton>
      </div>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Web Push notifications</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Send a push to your registered devices when a background task finishes. Requires the <strong>RemoteHost</strong> connection — its sign-in provides the
        notification auth, so pushes only send while it's connected.
      </p>
      <label class="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="cursor-pointer"
          :checked="props.pushEnabled ?? false"
          aria-label="Send a Web Push when a task finishes"
          @change="onPushToggle"
        />
        <span>Notify my devices when a task finishes</span>
      </label>

      <h3 class="mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Google account</h3>
      <p class="mb-3 mt-1.5 text-[12px] text-dim">
        Link a Google account so the <code>google</code> tool and your phone can read and create <strong>Calendar</strong> events. Sign-in opens in a new tab
        and finishes on <strong>this machine</strong>, so use a browser here — over a remote connection, run
        <code>npx mulmoterminal google login</code> instead. The link is shared with MulmoClaude.
      </p>
      <p v-if="googleSecretHint" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-[var(--danger)]">{{ googleSecretHint }}</p>
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
      <p v-if="googleError" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-[var(--danger)]" role="alert">{{ googleError }}</p>

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
            ✕
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
            ✕
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
            ✕
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

      <div class="mt-4 flex items-center gap-2">
        <span class="flex-1" />
        <SettingsButton primary @click="emit('close')">Close</SettingsButton>
      </div>
    </div>
  </div>
</template>
