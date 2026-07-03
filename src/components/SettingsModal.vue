<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useTheme } from "../composables/useTheme";
import { previewAttention } from "../composables/useAttentionSound";
import type { Launcher } from "./launchers";

const props = defineProps<{ soundFile?: string | null; prRepos?: string[]; launchers?: Launcher[] }>();
const emit = defineEmits<{
  (e: "update-sound", file: string | null): void;
  (e: "update-repos", repos: string[]): void;
  (e: "update-launchers", launchers: Launcher[]): void;
  (e: "close"): void;
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
  themesEl.value?.querySelectorAll<HTMLElement>(".theme-card")[next]?.focus();
}

const modalEl = ref<HTMLElement>();

// Modal keyboard behavior: Escape closes; Tab is trapped within the dialog.
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
    return;
  }
  if (e.key !== "Tab" || !modalEl.value) return;
  const focusable = [...modalEl.value.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute("disabled"),
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  nextTick(() => modalEl.value?.querySelector<HTMLElement>("input, button")?.focus());
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div ref="modalEl" class="modal" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="modal-head">
        <h2 class="modal-title">Settings</h2>
        <button class="icon-btn" title="Close" aria-label="Close settings" @click="emit('close')">✕</button>
      </div>

      <h3 class="section-title">Theme</h3>
      <div ref="themesEl" class="themes" role="radiogroup" aria-label="Theme">
        <button
          v-for="(t, i) in themes"
          :key="t.id"
          type="button"
          class="theme-card"
          :class="{ active: themeId === t.id }"
          role="radio"
          :aria-checked="themeId === t.id"
          :tabindex="themeId === t.id ? 0 : -1"
          :title="t.label"
          @click="setTheme(t.id)"
          @keydown="onThemeKey($event, i)"
        >
          <span class="swatch" :style="{ background: t.swatch.base }">
            <span class="swatch-dot" :style="{ background: t.swatch.panel }" />
            <span class="swatch-dot" :style="{ background: t.swatch.accent }" />
          </span>
          <span class="theme-label">{{ t.label }}</span>
        </button>
      </div>

      <h3 class="section-title">Notification sound</h3>
      <p class="hint">Played when a session needs attention. Leave empty for the built-in chime, or point to your own audio file.</p>
      <div class="sound-row">
        <input
          v-model="soundPath"
          class="field sound-field"
          type="text"
          placeholder="/absolute/path/to/sound.wav"
          aria-label="Custom notification sound file"
          spellcheck="false"
          @change="applySound"
        />
        <button class="btn" type="button" @click="browseSound">Browse…</button>
      </div>
      <div class="sound-actions">
        <button class="btn" type="button" title="Play the current sound" @click="testSound">▶ Test</button>
        <button class="btn" type="button" :disabled="!soundPath" title="Use the built-in chime" @click="clearSound">Use chime</button>
      </div>

      <h3 class="section-title">Pull request repos</h3>
      <p class="hint">
        Repos whose open PRs the cross-repo <strong>Pull requests</strong> view lists. Uses your <code>gh</code> login. Format: <code>owner/repo</code>.
      </p>
      <ul v-if="repos.length" class="repo-list">
        <li v-for="r in repos" :key="r" class="repo-item">
          <span class="repo-name">{{ r }}</span>
          <button class="icon-btn" type="button" :title="`Remove ${r}`" :aria-label="`Remove ${r}`" @click="removeRepo(r)">✕</button>
        </li>
      </ul>
      <div class="sound-row">
        <input
          v-model="newRepo"
          class="field repo-field"
          type="text"
          placeholder="owner/repo"
          aria-label="Add a repository (owner/repo)"
          spellcheck="false"
          @keydown.enter="addRepo"
        />
        <button class="btn" type="button" :disabled="!newRepoValid" @click="addRepo">Add</button>
      </div>

      <h3 class="section-title">Launch commands</h3>
      <p class="hint">
        Programs a grid cell can launch besides Claude — a plain shell, <code>codex</code>, any interactive command. They run in the cell's directory as a
        persistent terminal. Example: <code>Shell</code> → <code>$SHELL</code>, <code>Codex</code> → <code>codex</code>.
      </p>
      <ul v-if="launcherList.length" class="repo-list">
        <li v-for="l in launcherList" :key="l.label" class="repo-item">
          <span class="repo-name">{{ l.label }}</span>
          <code class="launcher-cmd">{{ l.command }}</code>
          <button class="icon-btn" type="button" :title="`Remove ${l.label}`" :aria-label="`Remove ${l.label}`" @click="removeLauncher(l.label)">✕</button>
        </li>
      </ul>
      <div class="sound-row launcher-add">
        <input
          v-model="newLauncherLabel"
          class="field launcher-label"
          type="text"
          placeholder="Label"
          aria-label="Launcher label"
          spellcheck="false"
          @keydown.enter="addLauncher"
        />
        <input
          v-model="newLauncherCommand"
          class="field repo-field"
          type="text"
          placeholder="command (e.g. $SHELL)"
          aria-label="Launcher command"
          spellcheck="false"
          @keydown.enter="addLauncher"
        />
        <button class="btn" type="button" :disabled="!newLauncherValid" @click="addLauncher">Add</button>
      </div>

      <div class="modal-foot">
        <span class="spacer" />
        <button class="btn btn-primary" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  color: var(--text);
  font-family: system-ui, sans-serif;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.section-title {
  margin: 14px 0 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.themes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 84px;
  padding: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
}
.theme-card:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.theme-card.active {
  border-color: var(--accent);
  color: var(--text);
}
.swatch {
  position: relative;
  width: 100%;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.swatch-dot {
  position: absolute;
  bottom: 6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.swatch-dot:nth-child(1) {
  left: 8px;
}
.swatch-dot:nth-child(2) {
  left: 24px;
}
.theme-label {
  font-size: 12px;
}
.hint {
  margin: 6px 0 12px;
  font-size: 12px;
  color: var(--text-dim);
}
.field {
  box-sizing: border-box;
  padding: 7px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.field:focus {
  outline: none;
  border-color: var(--accent);
}
.sound-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.sound-field {
  flex: 1 1 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
}
.repo-field {
  flex: 1 1 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
}
.launcher-label {
  flex: 0 0 30%;
  min-width: 0;
}
.launcher-add {
  flex-wrap: wrap;
}
.launcher-cmd {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.repo-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.repo-name {
  flex: 1 1 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  color: var(--text-secondary);
}
.sound-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.modal-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.spacer {
  flex: 1;
}
.icon-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 6px;
}
.icon-btn:hover {
  background: var(--err-hover-bg);
  color: var(--err-text);
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
}
.btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.btn-primary {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn-primary:hover {
  background: var(--accent-bg-hover);
}
</style>
