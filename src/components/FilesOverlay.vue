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
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Files">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <span class="text-[14px] font-[650] text-fg">Files</span>
      <span class="max-w-[40%] truncate font-mono text-[11px] text-muted" :title="cwd ?? ''">{{ cwd ?? "(default workspace)" }}</span>
      <span class="flex-auto" />
      <span v-if="openPath" class="font-mono text-[12px]" :class="dirty ? 'text-fg' : 'text-secondary'"
        >{{ openName }}<span v-if="dirty" class="ml-1 text-amber" title="Unsaved">●</span></span
      >
      <button
        v-if="openPath && isMarkdown"
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        @click="showPreview = !showPreview"
      >
        {{ showPreview ? "Edit" : "Preview" }}
      </button>
      <button
        v-if="openPath"
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-accent bg-accent-bg px-2.5 py-1 text-[12px] text-on-accent enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="!dirty || saving"
        @click="save"
      >
        {{ saving ? "Saving…" : "Save" }}
      </button>
      <button
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        title="Reload tree"
        aria-label="Reload tree"
        @click="loadRoot"
      >
        ↻
      </button>
      <button
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        title="Close"
        aria-label="Close files"
        @click="requestClose"
      >
        ✕
      </button>
    </header>
    <div class="flex min-h-0 flex-auto">
      <nav class="basis-[clamp(200px,24%,340px)] shrink-0 grow-0 overflow-auto border-r border-border py-1.5" aria-label="File tree">
        <p v-if="treeError" class="p-4 text-[13px] text-err">{{ treeError }}</p>
        <p v-else-if="roots.length === 0" class="p-4 text-[13px] text-muted">Empty directory.</p>
        <button
          v-for="{ node, depth } in rows"
          :key="node.path"
          type="button"
          data-testid="files-row"
          class="flex w-full cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent px-2 py-[3px] text-left font-mono text-[12px]"
          :class="node.path === openPath ? 'bg-hover text-fg' : 'text-secondary hover:bg-hover hover:text-fg'"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          @click="openFile(node)"
        >
          <span class="w-2.5 flex-none text-dim">{{ node.dir ? (node.expanded ? "▾" : "▸") : "" }}</span>
          <span class="flex-none">{{ node.dir ? "📁" : "📄" }}</span>
          <span class="truncate">{{ node.name }}</span>
        </button>
      </nav>
      <section class="relative flex min-w-0 flex-auto">
        <p v-if="fileError" class="p-4 text-[13px] text-err">{{ fileError }}</p>
        <p v-if="!openPath" class="m-auto p-4 text-[13px] text-muted">Select a file to view or edit.</p>
        <iframe v-show="openPath && showPreview" class="flex-auto border-0 bg-white" :src="previewSrc" sandbox="" title="Markdown preview" />
        <div v-show="openPath && !showPreview" ref="editorHost" class="files-editor min-w-0 flex-auto overflow-hidden" />
      </section>
    </div>
  </div>
</template>

<!-- The CodeMirror editor is injected into .files-editor at runtime, so its root
     can't carry a utility and must be sized via :deep. -->
<style scoped>
.files-editor :deep(.cm-editor) {
  height: 100%;
}
</style>
