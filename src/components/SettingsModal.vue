<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import type { CwdPreset } from "./presets";
import { useTheme } from "../composables/useTheme";
import { previewAttention } from "../composables/useAttentionSound";

const props = defineProps<{ presets: CwdPreset[]; soundFile?: string | null; saving?: boolean; error?: string | null }>();
const emit = defineEmits<{ (e: "save", presets: CwdPreset[]): void; (e: "update-sound", file: string | null): void; (e: "close"): void }>();

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

// Theme is applied immediately on click (independent of the Save button, which
// only commits the directory presets).
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

// Edit a local copy; commit on Save.
const rows = ref<CwdPreset[]>(props.presets.map((p) => ({ ...p })));
// Becomes true once the user edits, so a late prop sync can't clobber their work.
const dirty = ref(false);
// Resync if the presets arrive/change after mount — e.g. the modal opened before
// /api/config resolved (would otherwise edit empty data and Save could wipe the
// real presets). Only while the form is pristine, to preserve in-progress edits.
watch(
  () => props.presets,
  (next) => {
    if (!dirty.value) rows.value = next.map((p) => ({ ...p }));
  },
);
const modalEl = ref<HTMLElement>();

function addRow() {
  dirty.value = true;
  rows.value.push({ label: "", path: "" });
}
function removeRow(i: number) {
  dirty.value = true;
  rows.value.splice(i, 1);
}
function save() {
  const cleaned = rows.value.map((r) => ({ label: r.label.trim(), path: r.path.trim() })).filter((r) => r.label && r.path);
  emit("save", cleaned);
}

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

      <h3 class="section-title">Directory presets</h3>
      <p class="hint">Quick-pick directories offered when launching a terminal.</p>

      <div class="rows">
        <div v-for="(row, i) in rows" :key="i" class="row">
          <input
            v-model="row.label"
            class="field label-field"
            type="text"
            placeholder="Label"
            aria-label="Preset label"
            spellcheck="false"
            @input="dirty = true"
          />
          <input
            v-model="row.path"
            class="field path-field"
            type="text"
            placeholder="/absolute/path"
            aria-label="Preset directory path"
            spellcheck="false"
            @input="dirty = true"
          />
          <button class="icon-btn" title="Remove" aria-label="Remove preset" @click="removeRow(i)">✕</button>
        </div>
        <p v-if="rows.length === 0" class="empty">No presets yet.</p>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="modal-foot">
        <button class="btn" @click="addRow">＋ Add preset</button>
        <span class="spacer" />
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? "Saving…" : "Save" }}</button>
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
.rows {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
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
.label-field {
  flex: 0 0 30%;
}
.path-field {
  flex: 1 1 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
}
.empty {
  font-size: 12px;
  color: var(--text-dim);
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
.sound-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.error {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--err-text);
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
