<script setup lang="ts">
// The file explorer + editor itself, independent of where it is shown: the full-screen
// Files view (FilesOverlay) and the pane beside a zoomed grid cell mount the same thing.
// Left: a lazy-loaded directory tree rooted at `cwd`. Right: a CodeMirror editor, with a
// Markdown preview toggle that reuses the server's sandboxed md→HTML iframe. Writes go
// through PUT .../write, whose `path` the server contains within the project root.
//
// It owns no notion of routes or of being open — the host decides when it exists, and
// calls `reload()` after a root change it has already cleared with the user.
import { onBeforeUnmount, onMounted, ref, computed, nextTick, useTemplateRef, watch } from "vue";
import { ancestorDirs, expandedPaths, restoreOrder } from "./filesTreeState";
import { useFilesTree, type TreeNode } from "../composables/useFilesTree";
import { useOpenFile } from "../composables/useOpenFile";
import type { FilesPaneState } from "./filesPaneState";
import FileFinder from "./FileFinder.vue";
import FileSearch from "./FileSearch.vue";
import { useFileSearchPanel } from "../composables/useFileSearchPanel";
import FilesToolbarButton from "./FilesToolbarButton.vue";
import { canOpenInCanvas, absoluteUnder, type StoriesRoots } from "../composables/canvasOpenFile";
import { filesRowActions, type FilesRowAction } from "./filesRowActions";
import { useFilesRowMenu } from "../composables/useFilesRowMenu";
import { askTheMachine } from "./filesPaneApi";

const props = defineProps<{
  cwd: string | null;
  requestedPath?: string | null;
  initialState?: FilesPaneState | null;
  canvasTarget?: boolean;
  // Whether there is a terminal beside this pane to insert a path into, and which directory it
  // is in. Two props rather than one: the pane can TRAIL that cell after a declined re-root, so
  // "there is a terminal" and "it is in my directory" are genuinely different questions.
  insertTarget?: boolean;
  insertTargetCwd?: string | null;
  // Where stories live, as one value: the workspace path alone cannot address a deck kept beside
  // its notes — that needs the id this server registered the subtree under (#1933).
  storiesRoots?: StoriesRoots;
}>();
const emit = defineEmits<{ close: []; dirty: [boolean]; "open-in-canvas": [path: string]; "insert-text": [text: string] }>();

// The tree is its own thing now (#2158): what has been read, what is expanded, what is on screen.
// The markup for it stays here.
const tree = useFilesTree(() => props.cwd);
// And so is the open file: the buffer, the editor it is shown in, the reader's place in it, and
// every way it is written back. Destructured because the template names these directly.
const file = useOpenFile(() => props.cwd);
const { openPath, openName, dirty, editSeq, saving, fileError, unpreviewable, conflict, showPreview, isMarkdown, previewSrc } = file;
const { flush, save, overwrite, discardAndReload, openInOs } = file;
// Whether the Canvas has a View for the open file — the plugins' own gates decide, not an
// extension test here (see canvasOpenFile.ts).
// Gated on the path the CARD will carry, not the row's relative one: a cell whose directory has a
// dot segment (`~/.config/proj`) makes `p.html` pass here and the joined path fail the plugin's
// own guard, which is a button that does nothing when pressed.
const NO_ROOTS: StoriesRoots = { workspaces: [], roots: [] };
const storiesRoots = computed<StoriesRoots>(() => props.storiesRoots ?? NO_ROOTS);
const canvasOpenable = computed(() => canOpenInCanvas(openPath.value ? absoluteUnder(props.cwd, openPath.value) : null, storiesRoots.value));

const editorHost = ref<HTMLDivElement>();

// The host guards its own navigation on this, so it has to hear every change.
watch(dirty, (value) => emit("dirty", value));

// The row menu: right-click a tree row (or Shift+F10 / the Menu key on it) to put its path at
// the terminal's cursor (#1859). Teleported and fixed-positioned for CockpitRowMenu's reason —
// the tree scrolls inside an overflow container, which would clip a panel left in place.
const rowMenuEl = useTemplateRef<HTMLElement>("rowMenuEl");
const insertTerminal = computed(() => (props.insertTarget ? { cwd: props.insertTargetCwd ?? null } : null));

/** What a row offers. Kept here rather than in the composable because it is the end that reads
 *  this pane's props. */
const rowActionsFor = (node: TreeNode): FilesRowAction[] =>
  filesRowActions({
    pathRel: node.path,
    // Decides the wording and what the file manager is asked to do: a folder is opened, a file
    // is selected inside its own (#2039).
    isDir: node.dir,
    cwd: props.cwd,
    terminal: insertTerminal.value,
    // The same pair the header's Canvas button is drawn from, so a row can never offer what that
    // button would refuse — `canvasTarget` is "there is a cell to put a Canvas beside" and the
    // overlay mount has none.
    canvas: props.canvasTarget ? { roots: storiesRoots.value } : null,
  });

/** What picking one does — the other end that belongs to this pane, because it emits. */
function runRowAction(action: FilesRowAction): void {
  // The Canvas entry carries the row's path, not text for the terminal — and it goes out on the
  // SAME emit as the header button, relative to the tree's root, so the receiver resolves it once.
  if (action.id === "open-canvas") emit("open-in-canvas", action.pathRel);
  // Not an emit: nothing above this pane takes part. The browser cannot open a file manager, so
  // the local server does it (#2039) — through filesPaneApi, like every other request here.
  else if (action.id === "reveal") void file.reportFailure(askTheMachine("/api/files/reveal", action.pathAbs, `could not show ${action.pathAbs}`));
  else emit("insert-text", action.text);
}

const {
  menu: rowMenu,
  open: openRowMenu,
  onMenuNav,
  onRowKeydown,
  pick: pickRowAction,
} = useFilesRowMenu<TreeNode>({
  menuEl: rowMenuEl,
  actionsFor: rowActionsFor,
  run: runRowAction,
});

async function openFile(node: TreeNode): Promise<void> {
  if (node.dir) return tree.toggleDir(node);
  await file.load(node.path);
}

// "Open by name" (#2099). Its own state rather than a route or a prop: the finder belongs to
// whichever pane the user is in, and BOTH mounts of this component have one — the pane beside a
// zoomed cell, where a keymap action opens it, and the full-screen view, where the header button
// is the only way in.
const finderOpen = ref(false);
const treeEl = useTemplateRef<HTMLElement>("treeEl");

function closeFinder(): void {
  finderOpen.value = false;
}

// "Search in files" (#2140) — the finder's companion, and its own panel for the reason its own
// header says: the rows are a file heading with matching lines under it, not one row per path.
// The editor is passed as a GETTER because the pane replaces it when the host element remounts.
const search = useFileSearchPanel({ dirty, openPath, editSeq, editor: () => file.editor.value, revealPath });

// Picking is "show me this file", not only "open it": the tree is how the user goes on to its
// neighbours, and a file opened with the tree still collapsed leaves them where they started.
function onFinderPick(pathRel: string): void {
  closeFinder();
  void revealPath(pathRel);
}

// Which reveal is the current one. A reveal spends most of its time FETCHING — one request per
// ancestor directory — so a second pick can overtake the first and finish before it. A read takes
// the newest generation as it goes, so the loser landing second would replace the file the user
// actually chose with the one they abandoned (CodeRabbit on #2102). Bumped by teardown too:
// a re-rooted pane must not be scrolled to a row from the project it just left.
let revealId = 0;

/** Open `pathRel` and put the tree on it. The ancestors are expanded OUTERMOST FIRST because each
 *  expansion fetches that directory's children — a child cannot be opened before its parent has
 *  been (the rule `restoreOrder` exists for). */
async function revealPath(pathRel: string): Promise<boolean> {
  const id = ++revealId;
  await started; // the tree may still be loading — expanding into an unread `roots` finds nothing
  if (id !== revealId) return false;
  for (const dirPath of ancestorDirs(pathRel)) {
    const node = tree.findNode(dirPath);
    if (node?.dir && !node.expanded) await tree.toggleDir(node);
    if (id !== revealId) return false; // a later pick took over while this one was fetching
  }
  await file.load(pathRel);
  await nextTick(); // the row only exists once the expansions above have rendered
  if (id !== revealId) return false;
  rowElementFor(pathRel)?.scrollIntoView({ block: "nearest" });
  // Whether the editor is REALLY showing what was asked for. `file.load` returns nothing and has
  // several ways to end without opening anything — the file is gone, the fetch failed, or it
  // declined to leave a dirty buffer that could not be saved — and in each
  // the editor keeps the previous document. A caller that goes on to scroll to a line number needs
  // to know that, or it scrolls an unrelated file to an arbitrary place while looking deliberate.
  return openPath.value === pathRel;
}

/** The tree row for a path. Found by walking the rendered rows rather than with an attribute
 *  selector: a path holds `"` and `\` as readily as any other character, and one would break a
 *  selector built by concatenation. */
function rowElementFor(pathRel: string): HTMLElement | undefined {
  return [...(treeEl.value?.querySelectorAll<HTMLElement>("[data-path]") ?? [])].find((el) => el.dataset.path === pathRel);
}

async function requestClose(): Promise<void> {
  if (await flush()) emit("close");
}

// Bound to this pane's own subtree, not to window: with a pane open beside a terminal,
// a window-level ⌘S would save while the user is typing into the terminal.
function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
  }
}

function teardown(): void {
  // Every generation, not only the reveal's: a read already in flight would otherwise land after
  // the re-root and adopt the OLD project's content into the new tree, because its own generation
  // check still passes (Codex on #2102). Invalidating ALL of them is what makes "the pane is being
  // torn down" stop the work, rather than each request's own successor. The tree's and the open
  // file's own generations are bumped by their `reset()` / `teardown()` below, for the same reason.
  revealId += 1;
  file.teardown();
  closeFinder();
  // And the search, for the finder's reason: the root is changing, and a panel left open goes on
  // showing the OLD project's matches. Clicking one then reveals that relative path under the NEW
  // root — opening a different file where the same path exists, and nothing where it does not.
  search.close();
  // The root is changing and nothing has been read for the new one — including the error, which
  // belonged to the root being left. The header's Reload button deliberately does NOT come through
  // here: that tree is still this root's, and swapping the result in beats replacing a correct tree
  // with "Loading…".
  tree.reset();
  // The element OUTLIVES the root — a re-root happens in place — so the scrollbar would still be
  // where the last directory left it, and a directory with nothing remembered would open
  // mid-scroll. `restore` puts a remembered offset back after this (Codex on #2156).
  if (treeEl.value) treeEl.value.scrollTop = 0;
}

// The current startup, so anything that needs the TREE can wait for it. The pane mounts with an
// unread `roots` and fills it from a request, and a reveal arriving in that window would find no
// ancestor to expand — it would open the file and leave the tree collapsed, which is the half of
// #2099 that the issue actually asked for ("ツリー側でもそのファイルの位置が分かると…"). The
// `files-find` shortcut makes that window reachable: it mounts the pane and opens the finder over
// it in the same breath (Codex on #2102).
let started: Promise<void> = Promise.resolve();

async function start(): Promise<void> {
  const reqIdAtStart = file.generation();
  await nextTick();
  if (editorHost.value) file.attach(editorHost.value);
  await tree.loadRoot();
  await restore(props.initialState ?? null, reqIdAtStart);
  // An explicitly requested path wins over whatever was remembered — it is the more recent
  // intent (a clicked path in terminal output).
  if (props.requestedPath) void file.load(props.requestedPath);
}

/** Put a remembered tree back: open its directories parents-first (each fetches its children),
 *  then the file that was open. Anything since deleted simply isn't found and is skipped.
 *  `reqIdAtStart` is the read generation at the beginning of start() — restore only
 *  opens the remembered file when no competing request arrived during THIS startup cycle. */
async function restore(state: FilesPaneState | null, reqIdAtStart: number): Promise<void> {
  if (!state) return;
  for (const dirPath of restoreOrder(state.expanded)) {
    const node = tree.findNode(dirPath);
    if (node?.dir && !node.expanded) await tree.toggleDir(node);
  }
  if (state.openPath && file.generation() === reqIdAtStart) await file.load(state.openPath, false, state);
  // Last, and only after a tick: the rows have to exist before there is anything to scroll past,
  // and the expansions above are what create them.
  if (state.treeScrollTop !== undefined) {
    await nextTick();
    if (treeEl.value) treeEl.value.scrollTop = state.treeScrollTop;
  }
}

// A second clicked path while the pane is already showing: nothing else changes, so
// without this the file would never open.
watch(
  () => props.requestedPath,
  (pathRel) => {
    if (pathRel) void file.load(pathRel);
  },
);

onMounted(() => {
  started = start();
});
onBeforeUnmount(teardown);

// `reload` is the host's way to say "the root changed and I have already cleared it with the
// user" — the pane never watches `cwd` itself, because reacting to it would discard a buffer
// the host may still be asking about.
defineExpose({
  /** Say why an action the pane STARTED could not finish — the Canvas open, whose refusal comes
   *  back from the server (#1941). Shown where the click happened, in the same place a failed save
   *  reports: a message the user has to go looking for is one they never read. */
  showError: (message: string) => {
    fileError.value = message;
  },
  /** What this pane looks like right now, for a host that will bring the user back here. */
  snapshot: (): FilesPaneState => ({
    openPath: openPath.value,
    expanded: expandedPaths(tree.roots.value ?? []),
    showPreview: showPreview.value,
    ...file.place(),
    treeScrollTop: treeEl.value?.scrollTop ?? 0,
  }),
  reload: async () => {
    teardown();
    started = start();
    await started;
  },
  /** Open the "find a file by name" panel (#2099). The host calls this for the `files-find`
   *  shortcut, which has to be able to open the pane first — so the entry point cannot live in
   *  the pane's own key handler, which only hears what is already inside it. */
  openFinder: () => {
    finderOpen.value = true;
  },
  /** Open the "search in files" panel (#2140). Same shape as openFinder, and for the same reason:
   *  the `files-search` shortcut has to be able to open the pane first. */
  openSearch: () => {
    search.open.value = true;
  },
  /** Open a file the host chose — a path clicked in terminal output (#910). Routed through the
   *  same load, which treats opening another file as leaving this one, so an unsaved buffer is
   *  flushed (or keeps the pane where it is) exactly as it would be from the tree. */
  openFile: (pathRel: string) => file.load(pathRel),
  flush,
});
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-auto flex-col" @keydown="onKeydown">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <slot name="title" />
      <span class="flex-auto" />
      <span v-if="openPath" class="min-w-0 truncate font-mono text-[12px]" :class="dirty ? 'text-fg' : 'text-secondary'"
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
      <!-- Only where there is a cell to open it beside: this pane is also mounted full-screen by
           FilesOverlay, which has no enlarged terminal and so nothing to put a Canvas next to. -->
      <button
        v-if="canvasTarget && canvasOpenable"
        type="button"
        data-testid="files-canvas-btn"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        title="Open this file in the Canvas"
        @click="openPath && emit('open-in-canvas', openPath)"
      >
        Canvas
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
      <!-- Each panel's only entrance that needs no configuration: neither `files-find` nor
           `files-search` has a default binding, so without these the features are invisible to
           anyone who has not written a keymap. -->
      <FilesToolbarButton icon="search" label="Find a file by name" test-id="files-find-btn" opens-a-panel @click="finderOpen = true" />
      <FilesToolbarButton icon="manage_search" label="Search in files" test-id="files-search-btn" opens-a-panel @click="search.open.value = true" />
      <FilesToolbarButton icon="refresh" label="Reload tree" @click="tree.loadRoot" />
      <FilesToolbarButton icon="close" label="Close files" @click="requestClose" />
    </header>
    <div class="flex min-h-0 flex-auto">
      <nav ref="treeEl" class="basis-[clamp(160px,24%,340px)] shrink-0 grow-0 overflow-auto border-r border-border py-1.5" aria-label="File tree">
        <p v-if="tree.error.value" class="p-4 text-[13px] text-err">{{ tree.error.value }}</p>
        <p v-else-if="tree.roots.value === null" data-testid="files-tree-loading" class="p-4 text-[13px] text-muted">Loading…</p>
        <p v-else-if="tree.roots.value.length === 0" data-testid="files-tree-empty" class="p-4 text-[13px] text-muted">Empty directory.</p>
        <button
          v-for="{ node, depth } in tree.rows.value"
          :key="node.path"
          type="button"
          data-testid="files-row"
          :data-path="node.path"
          class="flex w-full cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent px-2 py-[3px] text-left font-mono text-[12px]"
          :class="node.path === openPath ? 'bg-hover text-fg' : 'text-secondary hover:bg-hover hover:text-fg'"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          @click="openFile(node)"
          @contextmenu="openRowMenu(node, $event)"
          @keydown="onRowKeydown(node, $event)"
        >
          <span class="w-3.5 flex-none text-dim">
            <span v-if="node.dir" class="material-symbols-outlined" aria-hidden="true">{{ node.expanded ? "expand_more" : "chevron_right" }}</span>
          </span>
          <span class="material-symbols-outlined flex-none" aria-hidden="true">{{ node.dir ? "folder" : "description" }}</span>
          <span class="truncate">{{ node.name }}</span>
        </button>
      </nav>
      <section class="relative flex min-w-0 flex-auto">
        <div
          v-if="conflict"
          role="alert"
          data-testid="files-conflict"
          class="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-amber bg-[var(--warn-bg-subtle)] px-4 py-2 text-[13px] text-warn"
        >
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <span class="flex-auto">This file changed on disk. Nothing was saved — your version is kept as a backup either way.</span>
          <button
            type="button"
            class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg"
            @click="discardAndReload"
          >
            Reload (discard your edits)
          </button>
          <button
            type="button"
            class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg"
            @click="overwrite"
          >
            Overwrite anyway
          </button>
        </div>
        <!-- `role="alert"`, like the conflict banner above it: every message here lands AFTER an
             action the user started (a save, a read, a Canvas open that the server refused), so a
             reader who is not looking at this pane learns nothing without a live region — which is
             the same dead-button silence #1941 removed for everyone else. -->
        <p v-if="fileError" role="alert" data-testid="files-error" class="p-4 text-[13px] text-err">{{ fileError }}</p>
        <p v-if="!openPath" class="m-auto p-4 text-[13px] text-muted">Select a file to view or edit.</p>
        <!-- Not text. The editor is hidden rather than shown empty: an empty buffer over a file
             that has content is an invitation to save, and saving is what destroyed it (#2038). -->
        <div v-else-if="unpreviewable" class="m-auto flex flex-col items-center gap-2 p-4 text-center" data-testid="files-unpreviewable">
          <span class="material-symbols-outlined text-[28px] text-muted" aria-hidden="true">draft</span>
          <p class="text-[13px] text-muted">{{ unpreviewable }}</p>
          <button
            type="button"
            class="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] text-fg hover:bg-hover"
            data-testid="files-open-in-os"
            @click="openInOs"
          >
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span>
            Open in OS
          </button>
        </div>
        <iframe v-show="openPath && !unpreviewable && showPreview" class="flex-auto border-0 bg-white" :src="previewSrc" sandbox="" title="Markdown preview" />
        <div v-show="openPath && !unpreviewable && !showPreview" ref="editorHost" class="files-editor min-w-0 flex-auto overflow-hidden" />
      </section>
    </div>
    <FileFinder v-if="finderOpen" :cwd="cwd" @pick="onFinderPick" @close="closeFinder" />
    <FileSearch v-if="search.open.value" :cwd="cwd" :buffer="search.buffer.value" @pick="search.onPick" @close="search.close" />
    <Teleport to="body">
      <div
        v-if="rowMenu"
        ref="rowMenuEl"
        data-testid="files-row-menu"
        role="menu"
        class="fixed z-[60] min-w-[200px] rounded-lg border border-border bg-panel p-1.5 text-fg shadow-xl"
        :style="{ top: `${rowMenu.top}px`, left: `${rowMenu.left}px` }"
        @keydown="onMenuNav"
      >
        <button
          v-for="action in rowMenu.actions"
          :key="action.id"
          type="button"
          role="menuitem"
          :data-testid="`files-row-action-${action.id}`"
          class="flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] text-secondary hover:bg-hover hover:text-fg"
          @click="pickRowAction(action)"
        >
          <span class="material-symbols-outlined text-[15px]" aria-hidden="true">{{ action.icon }}</span> {{ action.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
