<script setup lang="ts">
import { ref, onUnmounted, watch, useTemplateRef } from "vue";

// A header dropdown that browses the open project's files (the terminal's resolved
// cwd) and opens a picked file in a new browser tab — markdown rendered, everything
// else served raw (images inline, text as text/plain). Read-only; no editing.
interface BrowseEntry {
  name: string;
  dir: boolean;
  size: number;
}
const props = defineProps<{ cwd: string | null }>();

const open = ref(false);
const relPath = ref(""); // dir being listed, relative to the project root
const entries = ref<BrowseEntry[]>([]);
const loading = ref(false);
let req = 0; // request token: drop out-of-order responses

const rootRef = useTemplateRef<HTMLElement>("root");

const MD_RE = /\.(md|markdown)$/i;
const fileUrl = (name: string) => {
  const p = relPath.value ? `${relPath.value}/${name}` : name;
  const kind = MD_RE.test(name) ? "md" : "raw";
  return `/api/files/browse/${kind}?cwd=${encodeURIComponent(props.cwd ?? "")}&path=${encodeURIComponent(p)}`;
};

async function loadDir() {
  if (!props.cwd) return;
  const reqId = ++req;
  loading.value = true;
  try {
    const res = await fetch(`/api/files/browse/list?cwd=${encodeURIComponent(props.cwd)}&path=${encodeURIComponent(relPath.value)}`);
    const data = res.ok ? await res.json() : { entries: [] };
    if (reqId !== req) return;
    entries.value = Array.isArray(data.entries) ? data.entries : [];
  } catch {
    if (reqId === req) entries.value = [];
  } finally {
    if (reqId === req) loading.value = false;
  }
}

function enter(entry: BrowseEntry) {
  if (entry.dir) {
    relPath.value = relPath.value ? `${relPath.value}/${entry.name}` : entry.name;
    loadDir();
  } else {
    window.open(fileUrl(entry.name), "_blank", "noopener");
  }
}
function goUp() {
  relPath.value = relPath.value.split("/").slice(0, -1).join("/");
  loadDir();
}

function onOutside(e: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) close();
}
function onEscape(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
function openMenu() {
  open.value = true;
  loadDir();
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onEscape);
}
function close() {
  open.value = false;
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onEscape);
}
function toggle() {
  if (open.value) close();
  else openMenu();
}

// A cwd change (session switch) invalidates the listing: close and reset to root so
// the next open browses the new project from the top.
watch(
  () => props.cwd,
  () => {
    close();
    relPath.value = "";
    entries.value = [];
  },
);

onUnmounted(close);
</script>

<template>
  <div v-if="cwd" ref="root" class="file-menu">
    <button class="file-trigger" :class="{ active: open }" :aria-expanded="open" aria-haspopup="menu" title="Browse project files" @click="toggle">
      📁 Files ▾
    </button>
    <div v-if="open" class="file-pop" role="menu">
      <div class="file-crumb">
        <button class="file-up" :disabled="!relPath" title="Up" @click="goUp">↑</button>
        <span class="file-path">{{ relPath || "/" }}</span>
      </div>
      <div v-if="loading" class="file-empty">Loading…</div>
      <div v-else-if="!entries.length" class="file-empty">Empty</div>
      <button v-for="e in entries" :key="e.name" class="file-item" role="menuitem" :title="e.name" @click="enter(e)">
        <span class="file-icon">{{ e.dir ? "📁" : "📄" }}</span>
        <span class="file-name">{{ e.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.file-menu {
  position: relative;
  display: inline-flex;
}

/* Matches the terminal-header buttons. */
.file-trigger {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-family: system-ui, sans-serif;
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.file-trigger:hover,
.file-trigger.active {
  background: var(--bg-hover);
  color: var(--text);
}

.file-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  width: 320px;
  max-height: 60vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.file-crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.file-up {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  padding: 1px 7px;
}
.file-up:disabled {
  opacity: 0.4;
  cursor: default;
}
.file-path {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.file-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.file-icon {
  flex: 0 0 auto;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-empty {
  padding: 8px;
  color: var(--text-muted);
  font-family: system-ui, sans-serif;
  font-size: 12px;
}
</style>
