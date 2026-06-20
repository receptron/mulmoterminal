<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import type { CwdPreset } from "./presets";

const props = defineProps<{ presets: CwdPreset[]; saving?: boolean; error?: string | null }>();
const emit = defineEmits<{ (e: "save", presets: CwdPreset[]): void; (e: "close"): void }>();

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
        <h2 class="modal-title">Directory presets</h2>
        <button class="icon-btn" title="Close" aria-label="Close settings" @click="emit('close')">✕</button>
      </div>
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
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 10px;
  padding: 16px;
  color: #e6e6f0;
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
.hint {
  margin: 6px 0 12px;
  font-size: 12px;
  color: #8b93b8;
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
  background: #11111f;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  color: #e6e6f0;
  font-size: 12px;
}
.field:focus {
  outline: none;
  border-color: #4a8cff;
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
  color: #6b7394;
}
.error {
  margin: 12px 0 0;
  font-size: 12px;
  color: #ff8080;
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
  color: #9aa3c0;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 6px;
}
.icon-btn:hover {
  background: #3a2030;
  color: #ff6b6b;
}
.btn {
  border: 1px solid #2a2a4e;
  background: #20203a;
  color: #c7cdf0;
  cursor: pointer;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
}
.btn:hover {
  background: #2a3b66;
  color: #fff;
}
.btn-primary {
  background: #2f5bd0;
  border-color: #4a8cff;
  color: #fff;
}
.btn-primary:hover {
  background: #3a6be0;
}
</style>
