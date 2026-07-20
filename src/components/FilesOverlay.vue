<script setup lang="ts">
// Full-screen file explorer + editor, a sibling of PrsOverlay. Driven by useFilesView
// (the /files?cwd= route). Left: a lazy-loaded directory tree rooted at the project dir.
// Right: a CodeMirror editor for the opened file, with a Markdown preview toggle that
// reuses the server's sandboxed md→HTML iframe. Writes go through PUT .../write, which
// contains the path within the project root.
import { onBeforeUnmount, onMounted, ref, computed, nextTick, watch } from "vue";
import { useFilesView, filesGotoIndex } from "../composables/useFilesView";
import { createEditor, langKindForFilename, type CmEditor } from "./cmEditor";

interface Node {
  name: string;
  path: string; // relative to the project root
  dir: boolean;
  size: number;
  expanded: boolean;
  loaded: boolean;
  children: Node[];
}
interface Entry {
  name: string;
  dir: boolean;
  size: number;
}

const { isOpen, cwd, close } = useFilesView();

const roots = ref<Node[]>([]);
const treeError = ref<string | null>(null);
const openPath = ref<string | null>(null);
const openName = computed(() => (openPath.value ? (openPath.value.split("/").pop() ?? "") : ""));
const dirty = ref(false);
const saving = ref(false);
const fileError = ref<string | null>(null);
const showPreview = ref(false);
const isMarkdown = computed(() => langKindForFilename(openName.value) === "markdown");

const editorHost = ref<HTMLDivElement>();
let editor: CmEditor | null = null;
let reqId = 0;
// `reverting`: a route change WE triggered to undo a declined leave/root-switch — skip
// its own watcher fire. `bypassGuard`: the close was already confirmed (requestClose),
// so the watcher must not prompt again.
let reverting = false;
let bypassGuard = false;

function qs(pathRel: string): string {
  const p = new URLSearchParams();
  if (cwd.value) p.set("cwd", cwd.value);
  p.set("path", pathRel);
  return p.toString();
}
const previewSrc = computed(() => (openPath.value ? `/api/files/browse/md?${qs(openPath.value)}` : ""));

function makeNode(e: Entry, parentPath: string): Node {
  return { name: e.name, path: parentPath ? `${parentPath}/${e.name}` : e.name, dir: e.dir, size: e.size, expanded: false, loaded: false, children: [] };
}

async function fetchEntries(pathRel: string): Promise<Entry[]> {
  const res = await fetch(`/api/files/browse/list?${qs(pathRel)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

async function loadRoot(): Promise<void> {
  const id = ++reqId;
  treeError.value = null;
  try {
    const entries = await fetchEntries("");
    if (id === reqId) roots.value = entries.map((e) => makeNode(e, ""));
  } catch (e) {
    if (id === reqId) treeError.value = e instanceof Error ? e.message : String(e);
  }
}

async function toggleDir(node: Node): Promise<void> {
  node.expanded = !node.expanded;
  if (node.expanded && !node.loaded) {
    try {
      node.children = (await fetchEntries(node.path)).map((e) => makeNode(e, node.path));
      node.loaded = true;
    } catch {
      node.expanded = false; // couldn't read — collapse again
    }
  }
}

// Depth-first flatten of the currently-visible rows (only descending into expanded
// dirs), so the template renders a flat list without a recursive component.
const rows = computed(() => {
  const out: { node: Node; depth: number }[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const node of nodes) {
      out.push({ node, depth });
      if (node.dir && node.expanded) walk(node.children, depth + 1);
    }
  };
  walk(roots.value, 0);
  return out;
});

// Guard any action that would drop the open buffer's unsaved edits (switching files,
// closing the view). Returns true to proceed.
function confirmDiscard(): boolean {
  return !dirty.value || window.confirm("Discard unsaved changes?");
}

async function openFile(node: Node): Promise<void> {
  if (node.dir) return toggleDir(node);
  if (node.path === openPath.value) return; // already open — no reload, no prompt
  if (!confirmDiscard()) return;
  const id = ++reqId;
  fileError.value = null;
  showPreview.value = false;
  try {
    const res = await fetch(`/api/files/browse/text?${qs(node.path)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const data = await res.json();
    if (id !== reqId) return;
    openPath.value = node.path;
    editor?.setDoc(typeof data.text === "string" ? data.text : "", node.name);
    dirty.value = false;
  } catch (e) {
    if (id === reqId) fileError.value = e instanceof Error ? e.message : String(e);
  }
}

async function save(): Promise<void> {
  if (!openPath.value || !editor || saving.value) return;
  saving.value = true;
  fileError.value = null;
  try {
    const res = await fetch(`/api/files/browse/write?${qs(openPath.value)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: editor.getDoc() }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    dirty.value = false;
  } catch (e) {
    fileError.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

function requestClose(): void {
  if (!confirmDiscard()) return;
  bypassGuard = true; // already confirmed — don't let the isOpen watcher prompt again
  close();
}

function onKeydown(e: KeyboardEvent): void {
  if (!isOpen.value) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
}

// The editor host only exists while the overlay is open (v-if), so create/destroy the
// CodeMirror instance and (re)load the tree as the view opens/closes or its root changes.
function teardown(): void {
  editor?.destroy();
  editor = null;
  roots.value = [];
  openPath.value = null;
  dirty.value = false;
  showPreview.value = false;
}
watch(
  [isOpen, cwd],
  async ([open, curCwd], prev) => {
    if (reverting) {
      reverting = false;
      return;
    }
    // Leaving the view (external nav / Back) OR changing root (?cwd=) mid-edit with
    // unsaved changes → confirm before discarding; declining restores the previous
    // route (re-opens /files at prevCwd) so the editor + buffer stay put. An explicit
    // Close already confirmed (bypassGuard), so don't prompt twice.
    const wasOpen = prev?.[0] ?? false;
    const prevCwd = prev?.[1] ?? null;
    const leaving = wasOpen && !open;
    const rootChanged = open && curCwd !== prevCwd;
    if (!bypassGuard && (leaving || rootChanged) && !confirmDiscard()) {
      reverting = true;
      filesGotoIndex(prevCwd);
      return;
    }
    bypassGuard = false;
    teardown();
    if (!open) return;
    await nextTick();
    if (editorHost.value) editor = createEditor(editorHost.value, () => (dirty.value = true));
    loadRoot();
  },
  { immediate: true },
);

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  teardown();
});
</script>

<template>
  <div v-if="isOpen" class="overlay-root" role="region" aria-label="Files">
    <header class="files-head">
      <span class="files-title">Files</span>
      <span class="files-root" :title="cwd ?? ''">{{ cwd ?? "(default workspace)" }}</span>
      <span class="files-spacer" />
      <span v-if="openPath" class="files-open" :class="{ dirty }">{{ openName }}<span v-if="dirty" class="files-dot" title="Unsaved">●</span></span>
      <button v-if="openPath && isMarkdown" type="button" class="files-btn" @click="showPreview = !showPreview">
        {{ showPreview ? "Edit" : "Preview" }}
      </button>
      <button v-if="openPath" type="button" class="files-btn files-save" :disabled="!dirty || saving" @click="save">
        {{ saving ? "Saving…" : "Save" }}
      </button>
      <button type="button" class="files-btn" title="Reload tree" aria-label="Reload tree" @click="loadRoot">↻</button>
      <button type="button" class="files-btn" title="Close" aria-label="Close files" @click="requestClose">✕</button>
    </header>
    <div class="files-body">
      <nav class="files-tree" aria-label="File tree">
        <p v-if="treeError" class="files-msg files-error">{{ treeError }}</p>
        <p v-else-if="roots.length === 0" class="files-msg">Empty directory.</p>
        <button
          v-for="{ node, depth } in rows"
          :key="node.path"
          type="button"
          class="files-row"
          :class="{ 'is-open': node.path === openPath }"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          @click="openFile(node)"
        >
          <span class="files-caret">{{ node.dir ? (node.expanded ? "▾" : "▸") : "" }}</span>
          <span class="files-icon">{{ node.dir ? "📁" : "📄" }}</span>
          <span class="files-name">{{ node.name }}</span>
        </button>
      </nav>
      <section class="files-main">
        <p v-if="fileError" class="files-msg files-error">{{ fileError }}</p>
        <p v-if="!openPath" class="files-msg files-empty">Select a file to view or edit.</p>
        <iframe v-show="openPath && showPreview" class="files-preview" :src="previewSrc" sandbox="" title="Markdown preview" />
        <div v-show="openPath && !showPreview" ref="editorHost" class="files-editor" />
      </section>
    </div>
  </div>
</template>

<style scoped src="./overlay.css"></style>
<style scoped>
.files-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.files-title {
  font-weight: 650;
  font-size: 14px;
  color: var(--text);
}
.files-root {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}
.files-spacer {
  flex: 1 1 auto;
}
.files-open {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  color: var(--text-secondary);
}
.files-open.dirty {
  color: var(--text);
}
.files-dot {
  color: var(--amber, #e0a030);
  margin-left: 4px;
}
.files-btn {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  padding: 4px 10px;
  height: 26px;
  font-size: 12px;
}
.files-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.files-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.files-save {
  border-color: var(--accent);
  color: var(--on-accent, #fff);
  background: var(--accent-bg, var(--accent));
}
.files-body {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}
.files-tree {
  flex: 0 0 clamp(200px, 24%, 340px);
  overflow: auto;
  border-right: 1px solid var(--border);
  padding: 6px 0;
}
.files-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 3px 8px;
  font-size: 12px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  text-align: left;
  white-space: nowrap;
}
.files-row:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.files-row.is-open {
  background: var(--bg-hover);
  color: var(--text);
}
.files-caret {
  flex: 0 0 auto;
  width: 10px;
  color: var(--text-dim);
}
.files-icon {
  flex: 0 0 auto;
}
.files-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.files-main {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
  display: flex;
}
.files-editor {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
.files-editor :deep(.cm-editor) {
  height: 100%;
}
.files-preview {
  flex: 1 1 auto;
  border: none;
  background: #fff;
}
.files-msg {
  padding: 16px;
  color: var(--text-muted);
  font-size: 13px;
}
.files-error {
  color: var(--err, #e0556b);
}
.files-empty {
  margin: auto;
}
</style>
