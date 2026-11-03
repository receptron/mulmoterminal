<script setup lang="ts">
// The file explorer + editor itself, independent of where it is shown: the full-screen
// Files view (FilesOverlay) and the pane beside a zoomed grid cell mount the same thing.
// Left: a lazy-loaded directory tree rooted at `cwd`. Right: a CodeMirror editor, with a
// Markdown preview toggle that reuses the server's sandboxed md→HTML iframe. Writes go
// through PUT .../write, whose `path` the server contains within the project root.
//
// It owns no notion of routes or of being open — the host decides when it exists, and
// calls `reload()` after a root change it has already cleared with the user.
import { onBeforeUnmount, onMounted, ref, shallowRef, computed, nextTick, useTemplateRef, watch } from "vue";
import type { FilesPanelSeed } from "../composables/filesPanelSeed";
import { expandedPaths } from "./filesTreeState";
import { ROOT_ROW, useFilesTree, type TreeNode } from "../composables/useFilesTree";
import { openFileMedia, useOpenFile } from "../composables/useOpenFile";
import { useFilesReveal } from "../composables/useFilesReveal";
import { useFilesPreviewWire } from "../composables/useFilesPreviewWire";
import PreviewCodeBlockDialog from "./PreviewCodeBlockDialog.vue";
import PreviewCopiedNotice from "./PreviewCopiedNotice.vue";
import type { FilesPaneState } from "./filesPaneState";
import { tabStripView, useFilesTabs } from "../composables/useFilesTabs";
import { useCarriedView } from "../composables/useSessionViewMode";
import { withCanvasView } from "./filesTabs";
import { nextTabIndex } from "./tabKeys";
import { previewLinkTarget } from "./previewLinkTarget";
import { previewFollowsAppTheme } from "./filePreviewKind";
import FilesUnpreviewable from "./FilesUnpreviewable.vue";
import FilesTreeRow from "./FilesTreeRow.vue";
import FilesTreeSplitter from "./FilesTreeSplitter.vue";
import FilesTabStrip from "./FilesTabStrip.vue";
import FilesRowMenuPanel from "./FilesRowMenuPanel.vue";
import FilesChangesButton from "./FilesChangesButton.vue";
import FilesSaveButton from "./FilesSaveButton.vue";
import { useFilesPaneGit } from "../composables/useFilesPaneGit";
import { restorePaneState } from "../composables/filesPaneRestore";
import FileFinder from "./FileFinder.vue";
import FilesTreeEmpty from "./FilesTreeEmpty.vue";
import DirConfigSaveNote from "./DirConfigSaveNote.vue";
import FileSearch from "./FileSearch.vue";
import { useFileSearchPanel } from "../composables/useFileSearchPanel";
import { useFileTreeWidth } from "../composables/useFileTreeWidth";
import FilesToolbarButton from "./FilesToolbarButton.vue";
import FilesEditorActions from "./FilesEditorActions.vue";
import type { StoriesRoots } from "../composables/canvasOpenFile";
import { filesRowActions, type FilesRowAction } from "./filesRowActions";
import { seedCanvasCard } from "../composables/canvasOpenFile";
import { csvSpreadsheetCard, openCsvAsSpreadsheet } from "../composables/csvSpreadsheetCard";
import { menuAttrsFor, useFilesRowMenu } from "../composables/useFilesRowMenu";
import { isTreeOpAction, useTreeFileOps } from "../composables/useTreeFileOps";
import { focusTreeRow } from "./treeRowFocus";
import { askTheMachine } from "./filesPaneApi";
import { selectionReferenceText } from "../composables/selectionReferenceText";
import type { FileLocation } from "../composables/filePathLocation";
import { useI18n } from "vue-i18n";
import { useFileOutline } from "../composables/useFileOutline";
import FilesOutlineMenu from "./FilesOutlineMenu.vue";
import FilesViewModeButtons from "./FilesViewModeButtons.vue";
import { previewTabUrl } from "./filesPreviewSrc";
import { isOutsidePath } from "./filesOutsidePath";
import { underRootAsWritten } from "../composables/pathWithinCwd";
import FilesCanvasView from "./FilesCanvasView.vue";
import FilesCanvasButton from "./FilesCanvasButton.vue";
import FilesGallery from "./FilesGallery.vue";
import FilesFolderView from "./FilesFolderView.vue";
import FilesConflictBanner from "./FilesConflictBanner.vue";
import { useFilesGallery } from "../composables/useFilesGallery";
import { useFolderView } from "../composables/useFolderView";
import { useFilesCanvasMode } from "../composables/useFilesCanvasMode";
import { showFileWith } from "../composables/useShowFile";
import { useSideBySide } from "../composables/useSideBySide";
import { useRequestedOpen } from "../composables/useRequestedOpen";
import { wantsNewTab } from "../composables/newTabModifier";
import FilesHistoryMenu from "./FilesHistoryMenu.vue";
import FilesRecentMenu from "./FilesRecentMenu.vue";
import FilesComparingBanner from "./FilesComparingBanner.vue";

const { t } = useI18n();

const props = defineProps<{
  cwd: string | null;
  requestedPath?: string | null;
  requestedLocation?: FileLocation | null;
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
  // The session of the cell beside the pane, which the view a new file opens in is remembered by
  // (#3075). Absent where there is no cell — the full-screen view — and then every file opens on its editor.
  viewModeSession?: string | null;
}>();
const emit = defineEmits<{
  close: [];
  /** The close button was pressed. Carries the save, so a host can finish closing even if this pane
   *  is unmounted before the save lands (a `close` emitted then is dropped). */
  closing: [saved: Promise<boolean>];
  dirty: [boolean];
  "insert-text": [text: string];
  "open-canvas": [];
}>();

// The tree is its own thing now (#2158): what has been read, what is expanded, what is on screen.
// The markup for it stays here.
const tree = useFilesTree(() => props.cwd);
// And so is the open file: the buffer, the editor it is shown in, the reader's place in it, and
// every way it is written back. Destructured because the template names these directly.
const file = useOpenFile(() => props.cwd);
const { openPath, openName, dirty, editSeq, saving, fileError, unpreviewable, conflict, showPreview, previewKind, previewSrc, dirConfigReport } = file;
// A file outside the root, open on its own (#3238): read and saved against its own directory by the
// request builders, and offered nothing of the root's — no row in the tree, no History or Changes
// (the root's git), no entry among this folder's recent files.
const outsideFile = computed(() => openPath.value !== null && isOutsidePath(openPath.value));
const pathUnderRoot = computed(() => (outsideFile.value ? null : openPath.value));
// The open file's Preview as a tab of its own, with the toolbar the pane has no need of (#3238).
const previewTab = computed(() => (openPath.value && previewKind.value ? previewTabUrl(previewKind.value, props.cwd, openPath.value) : null));
const openPreviewTab = (): void => {
  if (previewTab.value) window.open(previewTab.value, "_blank", "noopener,noreferrer");
};
const { mediaKind, mediaSrc } = openFileMedia(file, () => props.cwd);
const { flush, save, overwrite, discardAndReload, openInOs } = file;
// Which files are open as tabs, and which is in front (#2267). Every open below goes through it, so
// a path that already has a tab is brought forward rather than opened twice.
const carried = useCarriedView({ props, file, canvas: () => canvasMode });
// A folder shown as a gallery over the file area (#3079); any file opened, or a re-root, puts the files back.
const tabs = useFilesTabs(file, carried.inherit, () => gallery.close());
const gallery = useFilesGallery(() => props.cwd);
// The folder the empty file area shows (#3120): the last one clicked in the tree. Read only while no
// file is open and no gallery covers it — and only drawn then, so its tiles never play unseen.
const folderShown = computed(() => !openPath.value && gallery.dir.value === null);
const folder = useFolderView(
  () => props.cwd,
  () => folderShown.value,
);
// The tree row for what the right side shows: the open file, else the folder on show (#3136). The
// root has no row, so nothing is marked while it is shown.
const currentRowPath = computed(() => openPath.value ?? (folderShown.value && folder.dir.value ? folder.dir.value : null));
const { openRequested, openFromTerminal } = useRequestedOpen(tabs, file, (pathRel) => canvasMode.hide(pathRel));
const strip = tabs.strip;
const { showStrip, focusablePath, labels } = tabStripView(strip, openPath);
const storiesRoots = computed<StoriesRoots>(() => props.storiesRoots ?? { workspaces: [], roots: [] });
// The open file drawn by the Canvas's plugin view, in place of the editor (#3008).
const canvasMode = useFilesCanvasMode({ enabled: () => !!props.canvasTarget, cwd: () => props.cwd, storiesRoots: () => storiesRoots.value, file, tabs });
const { active: showCanvas, card: canvasCard, openable: canvasOpenable } = canvasMode;

const editorHost = ref<HTMLDivElement>();

// Preview is an iframe the pane cannot read into, so where the reader is in it arrives by message
// from the document's own reporter — and goes back the same way when that document reloads.
const previewScroll = useFilesPreviewWire(file, openPreviewLink, () => props.cwd);

// A Markdown file's headings, to go to one in the editor or the Preview (#2576).
const outline = useFileOutline({ editor: file.editor, showPreview, goToPreviewHeading: previewScroll.goToHeading });
const { layout, ...sideBySide } = useSideBySide({ file, editorHost, preview: previewScroll, showCanvas });

// A link clicked in the Preview (#2268), resolved against the document being read. It opens in a
// tab of its own, keeping the one it was clicked in; a Markdown file comes up in Preview, since
// that is where the reader was. A path above the root is refused where the click happened, rather
// than doing nothing.
function openPreviewLink(href: string): void {
  const docPath = openPath.value;
  if (!docPath) return;
  const target = previewLinkTarget(docPath, href);
  if (target.kind === "outside") fileError.value = `This link points outside this folder: ${href}`;
  else if (target.kind === "file") void tabs.open(target.path, true, { path: target.path, showPreview: true });
}

// The host guards its own navigation on this, so it has to hear every change.
watch(dirty, (value) => emit("dirty", value));

// The row menu: right-click a tree row (or Shift+F10 / the Menu key on it) to put its path at
// the terminal's cursor (#1859).
const rowMenuPanel = useTemplateRef<InstanceType<typeof FilesRowMenuPanel>>("rowMenuPanel");
const rowMenuEl = computed((): HTMLElement | null => rowMenuPanel.value?.el ?? null);
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
    rootListed: tree.roots.value !== null && !tree.error.value,
    terminal: insertTerminal.value,
    // The same pair the header's Canvas button is drawn from, so a row can never offer what that
    // button would refuse — `canvasTarget` is "there is a cell to put a Canvas beside" and the
    // overlay mount has none.
    canvas: props.canvasTarget ? { roots: storiesRoots.value } : null,
    trash: fileOps.trash.value,
  });

/** The @ button and key (#2575): the reference for the selection, at the terminal's prompt, not sent. */
async function insertSelection(): Promise<boolean> {
  const deps = {
    file,
    hasTarget: () => !!props.insertTarget,
    cwd: () => props.cwd,
    terminalCwd: () => props.insertTargetCwd ?? null,
    editorHidden: () => !layout.value.editor,
  };
  const text = await selectionReferenceText(deps);
  if (text !== null) emit("insert-text", text);
  return text !== null;
}

/** "Open as a spreadsheet": a spreadsheet copy of the CSV / TSV, put on the Canvas of the cell
 *  beside the pane — the same feed the agent's cards go to, so it is kept and comes back on reload. */
async function openAsSpreadsheet(pathRel: string): Promise<void> {
  const session = props.viewModeSession;
  const cwd = props.cwd;
  if (!session) {
    fileError.value = t("filesRowMenu.spreadsheetNoCell");
    return;
  }
  const outcome = await openCsvAsSpreadsheet({
    stillAsked: () => props.viewModeSession === session && props.cwd === cwd,
    buildCard: () => csvSpreadsheetCard(cwd, pathRel),
    seed: (card) => seedCanvasCard(session, card),
  });
  if (outcome.kind === "shown") emit("open-canvas");
  else if (outcome.kind === "refused") fileError.value = t(outcome.refusal.key, outcome.refusal.values);
  else if (outcome.kind === "notShown") fileError.value = t("filesRowMenu.spreadsheetNotShown");
}

/** What picking one does — the other end that belongs to this pane, because it emits. */
function runRowAction(action: FilesRowAction): void {
  if (action.id === "open-canvas") void canvasMode.open(action.pathRel);
  else if (action.id === "open-spreadsheet") void openAsSpreadsheet(action.pathRel);
  else if (action.id === "open-tab") void tabs.open(action.pathRel, true);
  else if (action.id === "open-gallery") void gallery.open(action.pathRel);
  // Not an emit: nothing above this pane takes part. The browser cannot open a file manager, so
  // the local server does it (#2039) — through filesPaneApi, like every other request here.
  else if (action.id === "reveal") void file.reportFailure(askTheMachine("/api/files/reveal", action.pathAbs, `could not show ${action.pathAbs}`));
  else if (action.id === "insert-relative" || action.id === "insert-absolute") emit("insert-text", action.text);
  else if (isTreeOpAction(action)) void fileOps.run(action);
}

// New, rename and Trash from the row menu (#2578); the browser's own dialogs ask for the name.
const focusRow = (p: string) => focusTreeRow(treeEl.value, p);
const fileOps = useTreeFileOps({
  cwd: () => props.cwd,
  tree,
  tabs,
  file,
  t,
  focusRow,
  changed: gallery.treeOpListener((op) => {
    void gitStatus.refresh();
    void folder.afterTreeOp(op);
  }),
});

const { menu: rowMenu, ...rowMenuApi } = useFilesRowMenu<TreeNode>({ menuEl: rowMenuEl, actionsFor: rowActionsFor, run: runRowAction });
// The menu on the tree's empty space and in an empty folder: the root as a row (#2694).
const rootMenu = menuAttrsFor(rowMenuApi, ROOT_ROW);

// Cmd/Ctrl+click asks for a tab of its own, as it asks a browser for one; a plain click replaces
// the front tab, as it replaced the one open file before tabs.
// A folder is also the one the empty file area shows (#3120), remembered while a file is open.
function openFile(node: TreeNode, event: MouseEvent): Promise<void> {
  stopShowing();
  if (!node.dir) return tabs.open(node.path, wantsNewTab(event));
  folder.show(node.path);
  return tree.toggleDir(node);
}

const stripEl = useTemplateRef("stripEl");

// Delete closes the focused tab, as the tab pattern suggests; the arrows move between tabs as they
// do in the collection chat strip. Focus goes to whichever tab is in front once the move settles,
// not the one asked for: a switch refused because the edits could not be saved leaves the old tab in
// front, and a closed tab's button is gone.
async function onTabKey(e: KeyboardEvent, index: number): Promise<void> {
  const tab = strip.value.tabs[index];
  const next = nextTabIndex(e.key, index, strip.value.tabs.length);
  const target = next === null ? undefined : strip.value.tabs[next];
  if (!tab || (e.key !== "Delete" && !target)) return;
  e.preventDefault();
  if (e.key === "Delete") await tabs.close(tab.path);
  else if (target) await tabs.open(target.path);
  await nextTick();
  focusAfterTabMove();
}

/** The front tab, or — once a close has left one tab and the strip is gone — the file the reader is
 *  now on: its editor, or the tree when the editor is not what is showing. Never nothing, which
 *  would drop a keyboard user on the page body. */
function focusAfterTabMove(): void {
  const tab = stripEl.value?.frontTab();
  const editor = layout.value.editor ? editorHost.value?.querySelector<HTMLElement>('[contenteditable="true"]') : null;
  (tab ?? editor ?? treeEl.value?.querySelector<HTMLElement>("button"))?.focus();
}

const treeEl = useTemplateRef<HTMLElement>("treeEl");

// What git sees, the open file's changes against HEAD, and its earlier versions.
const { gitStatus, git, head, showChanges, history } = useFilesPaneGit(() => props.cwd, { ...file, openPath: pathUnderRoot });

async function reloadTree(): Promise<void> {
  void gitStatus.refresh();
  folder.refresh();
  await tree.refreshAll();
}

/** A file opened from the folder view, whose row goes with the view: the keyboard follows the file. */
async function openFromFolder(path: string, newTab: boolean): Promise<void> {
  await tabs.open(path, newTab);
  await nextTick();
  if (document.activeElement === document.body) focusAfterTabMove();
}
const {
  shownWidth: treeWidth,
  minWidth: treeMin,
  maxWidth: treeMax,
  treeStyle,
  onSplitterDown: onTreeSplitterDown,
  onSplitterKey: onTreeSplitterKey,
} = useFileTreeWidth(treeEl);
// Revealing a path — opening it AND putting the tree on it — with the finder that asks for one
// (#2158). `started` is passed as a getter because `reload()` replaces that promise.
const {
  finderOpen,
  closeFinder,
  onFinderPick,
  revealPath,
  showFolderInTree,
  stopShowing,
  followFrontTab,
  startEpoch,
  reset: resetReveal,
} = useFilesReveal({
  tree,
  treeEl,
  started: () => started,
  open: (pathRel) => tabs.open(pathRel),
  openPath,
  frontPath: () => strip.value.activePath,
});

// "Search in files" (#2140) — the finder's companion, and its own panel for the reason its own
// header says: the rows are a file heading with matching lines under it, not one row per path.
// The editor is passed as a GETTER because the pane replaces it when the host element remounts.
// A move made in the folder view opens the tree down to that folder, so both sides show one place.
function showFromFolderView(dirRel: string): void {
  folder.show(dirRel);
  void showFolderInTree(dirRel, () => folderShown.value && folder.dir.value === dirRel);
}

const search = useFileSearchPanel({ dirty, openPath, editSeq, editor: () => file.editor.value, revealPath });

// The text a panel opens on: the palette's `/` or `#`, or nothing. A new object every time, so the
// panel hears it even when it is already open, and a plain open replaces the last one's text.
const finderSeed = shallowRef<FilesPanelSeed>({ text: "" });
const searchSeed = shallowRef<FilesPanelSeed>({ text: "" });
function openFinder(query = ""): void {
  finderSeed.value = { text: query };
  finderOpen.value = true;
}
function openSearch(query = ""): void {
  searchSeed.value = { text: query };
  search.open.value = true;
}

async function requestClose(): Promise<void> {
  const saved = flush();
  emit("closing", saved);
  if (await saved) emit("close");
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
  // Every generation, not only the file's: a read already in flight would otherwise land after the
  // re-root and adopt the OLD project's content into the new tree, because its own generation check
  // still passes (Codex on #2102). Invalidating ALL of them is what makes "the pane is being torn
  // down" stop the work, rather than each request's own successor — so all three say so here.
  resetReveal();
  gitStatus.reset();
  file.teardown();
  tabs.reset();
  canvasMode.reset();
  // And the search, for the finder's reason: the root is changing, and a panel left open goes on
  // showing the OLD project's matches. Clicking one then reveals that relative path under the NEW
  // root — opening a different file where the same path exists, and nothing where it does not.
  search.close();
  // The root is changing and nothing has been read for the new one — including the error, which
  // belonged to the root being left. The header's Reload button deliberately does NOT come through
  // here: that tree is still this root's, and swapping the result in beats replacing a correct tree
  // with "Loading…".
  tree.reset();
  folder.reset();
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
  // The pane's switch, not a file's, so a file opened for this start keeps it as an open pane would.
  // Before any await: a start that a reload has since replaced must not reach it (#3122).
  sideBySide.switchedOn.value = props.initialState?.sideBySide === true;
  const reqIdAtStart = file.generation();
  const startedAt = startEpoch();
  await nextTick();
  if (editorHost.value) file.attach(editorHost.value);
  // A re-root makes a new editor, which knows nothing of the reader's choice.
  file.editor.value?.setShowChanges(showChanges.value);
  void gitStatus.refresh();
  await tree.loadRoot();
  await restore(props.initialState ?? null, reqIdAtStart);
  if (!followFrontTab(startedAt)) return;
  // An explicitly requested path wins over whatever was remembered — it is the more recent
  // intent (a clicked path in terminal output).
  if (props.requestedPath) void openRequested(requestedUnderRoot(props.requestedPath), props.requestedLocation ?? null);
}

// A URL may spell a root file absolute; the pane reads an absolute tab path as a file OUTSIDE the
// root (#3238), so one under it is put back relative first — and one written relative is left as
// written, since folding it would read a `\` in a POSIX name as a separator.
const requestedUnderRoot = (requested: string): string => underRootAsWritten(requested, props.cwd);

const restore = (state: FilesPaneState | null, reqIdAtStart: number): Promise<void> =>
  restorePaneState({ tree, file, canvasMode, tabs, treeEl: () => treeEl.value }, state, reqIdAtStart);

// A second clicked path while the pane is already showing: nothing else changes, so
// without this the file would never open.
// Keyed by value: the route rebuilds the location object on every navigation, and a change of
// `?cwd=` alone must not re-open the same path at the same line in the old root.
watch(
  () => JSON.stringify([props.requestedPath ?? null, props.requestedLocation ?? null]),
  () => {
    if (props.requestedPath) void openRequested(requestedUnderRoot(props.requestedPath), props.requestedLocation ?? null);
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
  /** What this pane looks like right now, for a host that will bring the user back here. */
  snapshot: (): FilesPaneState => ({
    ...withCanvasView(tabs.current(), canvasMode.has),
    expanded: expandedPaths(tree.roots.value ?? []),
    treeScrollTop: treeEl.value?.scrollTop ?? 0,
    ...(sideBySide.switchedOn.value ? { sideBySide: true } : {}),
  }),
  reload: async () => {
    teardown();
    started = start();
    await started;
  },
  /** Open the "find a file by name" panel (#2099). The host calls this for the `files-find`
   *  shortcut, which has to be able to open the pane first — so the entry point cannot live in
   *  the pane's own key handler, which only hears what is already inside it. */
  openFinder: (query = "") => {
    openFinder(query);
  },
  /** Open the "search in files" panel (#2140). Same shape as openFinder, and for the same reason:
   *  the `files-search` shortcut has to be able to open the pane first. */
  openSearch: (query = "") => {
    openSearch(query);
  },
  /** Open a file the host chose — a path clicked in terminal output (#910). Routed through the
   *  same load, which treats opening another file as leaving this one, so an unsaved buffer is
   *  flushed (or keeps the pane where it is) exactly as it would be from the tree. */
  // A page, an SVG or a table comes up drawn: a path clicked in terminal output to a chart is asking
  // to see the chart, and a CSV opened from there as a table before the pane took the click (#2559).
  // Markdown opens as it always has.
  openFile: openFromTerminal,
  /** A file in a given view and at a given line, for an agent's `showInPane` or a check item (#3022). */
  showFile: showFileWith({ tabs, file, canvasMode, sideBySide, openAt: openFromTerminal }),
  /** The `files-insert-selection` key (#2575), reached from the grid like the tab keys. */
  insertSelection,
  /** The `files-tab-*` keys (#2267), reached from the grid like the finder's. */
  closeFrontTab: () => tabs.closeFront(),
  stepTab: (step: 1 | -1) => tabs.step(step),
  flush,
});
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-auto flex-col" @keydown="onKeydown">
    <header class="flex flex-none flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5 border-b border-border bg-panel px-4 py-2">
      <slot name="title" />
      <span class="flex-auto" />
      <span
        v-if="outsideFile && !showStrip"
        class="material-symbols-outlined text-dim"
        role="img"
        :aria-label="t('tips.panes.outsideFile', { path: openPath })"
        :data-tip="t('tips.panes.outsideFile', { path: openPath })"
        data-testid="files-outside-mark"
        >arrow_outward</span
      >
      <span v-if="openPath && !showStrip" class="min-w-0 truncate font-mono text-[12px]" :class="dirty ? 'text-fg' : 'text-secondary'"
        >{{ openName }}<span v-if="dirty" class="ml-1 text-amber" :data-tip="t('tips.panes.unsaved')">●</span></span
      >
      <FilesViewModeButtons
        v-if="openPath && previewKind && previewSrc && (!showCanvas || sideBySide.offered.value)"
        v-bind="{ showPreview, canPreview: !showCanvas, saving, canSideBySide: sideBySide.offered.value, sideBySide: sideBySide.active.value }"
        @toggle-preview="carried.choose(() => file.togglePreview())"
        @toggle-side-by-side="sideBySide.toggle()"
      />
      <FilesToolbarButton
        v-if="previewTab && !unpreviewable"
        icon="open_in_new"
        :label="t('tips.panes.previewTab')"
        test-id="files-preview-tab"
        @click="openPreviewTab"
      />
      <FilesChangesButton
        v-if="pathUnderRoot && head.hasOriginal.value && layout.editor && !unpreviewable"
        :pressed="showChanges"
        @toggle="showChanges = !showChanges"
      />
      <FilesOutlineMenu
        v-if="openPath && previewKind === 'markdown' && !unpreviewable && (layout.editor || layout.preview)"
        :key="`${openPath}:${showPreview}`"
        v-bind="outline.menu.value"
        @opened="outline.refresh()"
        @pick="outline.pick"
      />
      <FilesHistoryMenu
        v-if="pathUnderRoot && layout.editor && !unpreviewable && !conflict"
        v-bind="history.menu.value"
        @toggle="history.toggle()"
        @close="history.close()"
        @compare="history.compare"
        @restore="history.restore"
      />
      <!-- Only in the right pane: this pane is also mounted full-screen by FilesOverlay, whose base
           is a query string, and the plugin views stay off that surface (docs/file-surfaces.md). -->
      <FilesCanvasButton v-if="canvasTarget && canvasOpenable" :active="showCanvas" :disabled="saving" @toggle="carried.choose(() => canvasMode.toggle())" />
      <FilesSaveButton v-if="openPath" :dirty="dirty" :saving="saving" @save="save" />
      <!-- Each panel's only entrance that needs no configuration: neither `files-find` nor
           `files-search` has a default binding, so without these the features are invisible to
           anyone who has not written a keymap. -->
      <FilesRecentMenu :cwd="cwd" :open-path="pathUnderRoot" @open="(pathRel) => tabs.open(pathRel)" />
      <FilesToolbarButton icon="search" :label="t('tips.panes.findByName')" test-id="files-find-btn" opens-a-panel @click="openFinder()" />
      <FilesToolbarButton icon="manage_search" :label="t('tips.panes.searchInFiles')" test-id="files-search-btn" opens-a-panel @click="openSearch()" />
      <FilesEditorActions
        v-if="openPath && !unpreviewable && (!showCanvas || layout.editor)"
        :editor="file.editor.value"
        :can-insert="!!insertTarget"
        @insert="insertSelection"
      />
      <FilesToolbarButton icon="refresh" :label="t('tips.panes.reloadTree')" @click="reloadTree" />
      <FilesToolbarButton icon="right_panel_close" :label="t('tips.panes.closeFiles')" @click="requestClose" />
    </header>
    <FilesTabStrip
      v-if="showStrip"
      ref="stripEl"
      v-bind="{ strip, labels, focusablePath, openPath, dirty }"
      @open="(path) => tabs.open(path)"
      @close="(path) => tabs.close(path)"
      @key="onTabKey"
    />
    <!-- In the flow, not over the editor: it stays up for the whole comparison, and a bar laid over
         the text would hide line 1 — often the very change being compared. -->
    <FilesComparingBanner
      v-if="!conflict && history.comparing.value && layout.editor && !unpreviewable"
      :at="history.comparing.value.entry.at"
      :failed="history.restoreFailed.value"
      @restore="history.comparing.value && history.restore(history.comparing.value.entry)"
      @stop="head.stopComparing()"
    />
    <div class="flex min-h-0 flex-auto">
      <nav
        ref="treeEl"
        class="shrink-0 grow-0 overflow-auto py-1.5"
        :style="treeStyle()"
        :aria-label="t('tips.panes.fileTree')"
        data-testid="files-tree"
        v-bind="rootMenu"
      >
        <p v-if="tree.error.value" class="p-4 text-[13px] text-err">{{ tree.error.value }}</p>
        <p v-else-if="tree.roots.value === null" data-testid="files-tree-loading" class="p-4 text-[13px] text-muted">Loading…</p>
        <FilesTreeEmpty v-else-if="tree.roots.value.length === 0" :actions="rowActionsFor(ROOT_ROW)" @run="runRowAction" @menu="rootMenu.onContextmenu" />
        <FilesTreeRow
          v-for="{ node, depth } in tree.rows.value"
          :key="node.path"
          v-bind="{ node, depth, git, active: node.path === currentRowPath }"
          @click="openFile(node, $event)"
          @contextmenu="rowMenuApi.open(node, $event)"
          @keydown="rowMenuApi.onRowKeydown(node, $event)"
        />
      </nav>
      <FilesTreeSplitter v-bind="{ width: treeWidth, min: treeMin, max: treeMax }" @pointerdown.prevent="onTreeSplitterDown" @keydown="onTreeSplitterKey" />
      <section class="relative flex min-w-0 flex-auto">
        <FilesConflictBanner v-if="conflict" @reload="discardAndReload" @overwrite="overwrite" />
        <!-- `role="alert"`, like the conflict banner above it: every message here lands AFTER an
             action the user started (a save, a read, a Canvas open that the server refused), so a
             reader who is not looking at this pane learns nothing without a live region — which is
             the same dead-button silence #1941 removed for everyone else. -->
        <p v-if="fileError" role="alert" data-testid="files-error" class="p-4 text-[13px] text-err">{{ fileError }}</p>
        <DirConfigSaveNote v-if="dirConfigReport && openPath" :report="dirConfigReport" @dismiss="dirConfigReport = null" />
        <template v-if="!openPath">
          <FilesFolderView
            v-if="folderShown"
            v-bind="{
              cwd,
              dir: folder.dir.value,
              groups: folder.groups.value,
              error: folder.error.value,
              mode: folder.mode.value,
              withSubfolders: folder.withSubfolders.value,
            }"
            @show="showFromFolderView"
            @open="openFromFolder"
            @mode="folder.setMode"
            @subfolders="(on) => (folder.withSubfolders.value = on)"
          />
        </template>
        <!-- Not text. The editor is hidden rather than shown empty: an empty buffer over a file
             that has content is an invitation to save, and saving is what destroyed it (#2038). -->
        <FilesUnpreviewable
          v-else-if="unpreviewable"
          v-bind="{ kind: mediaKind, src: mediaSrc, name: openName, message: unpreviewable }"
          @open-in-os="openInOs"
        />
        <!-- `allow-scripts` and deliberately NOT `allow-same-origin`: the document renders a `.md`
             nothing sanitised, so it stays opaque-origin forever, and the server's own CSP lets a
             single nonce'd script run in it — the one that reports where the reader is (#2157).
             The effective sandbox is the intersection of this attribute and that header, so the
             permission has to be spelled in both. -->
        <!-- The documents the server renders (Markdown #2263, a CSV/TSV table #2559) are drawn in the
             app's colours; an HTML page or an SVG is not, and a page that sets no background expects
             the white a browser gives it — on the app's dark ground its default black text is
             unreadable. -->
        <!-- Keyed by WHO may speak in it, because `contentWindow` is the same object across a
             navigation: without a fresh frame, a page being replaced by a Markdown document could
             still post on the Markdown wire in the moment between the two (#2269 review). And a
             page is loaded only while it is being looked at — it runs its own scripts, which the
             Markdown document (the reporter is its only script) does not. -->
        <iframe
          v-show="openPath && !unpreviewable && layout.preview"
          ref="previewFrame"
          :key="previewKind === 'markdown' ? 'markdown' : 'page'"
          class="flex-auto border-0"
          :class="[previewFollowsAppTheme(previewKind) ? 'bg-[var(--bg-base)]' : 'bg-white', sideBySide.previewClass.value]"
          :src="previewKind === 'markdown' || showPreview ? previewSrc : ''"
          sandbox="allow-scripts"
          :title="previewKind === 'markdown' ? t('tips.panes.markdownPreview') : t('tips.panes.filePreview')"
        />
        <div v-show="openPath && !unpreviewable && layout.editor" ref="editorHost" :class="sideBySide.editorClass.value" />
        <FilesCanvasView v-if="openPath && showCanvas" :class="sideBySide.previewClass.value" :card="canvasCard" @update-result="canvasMode.onUpdateResult" />
        <FilesGallery
          v-if="gallery.dir.value !== null"
          v-bind="{ cwd, dir: gallery.dir.value, items: gallery.items.value, error: gallery.error.value }"
          @close="gallery.close()"
        />
      </section>
    </div>
    <FileFinder v-if="finderOpen" :cwd="cwd" :seed="finderSeed" @pick="onFinderPick" @close="closeFinder" />
    <FileSearch v-if="search.open.value" :cwd="cwd" :buffer="search.buffer.value" :seed="searchSeed" @pick="search.onPick" @close="search.close" />
    <FilesRowMenuPanel ref="rowMenuPanel" :menu="rowMenu" @nav="rowMenuApi.onMenuNav" @pick="rowMenuApi.pick" />
    <PreviewCodeBlockDialog v-if="previewScroll.codeBlock?.shown.value" :lookup="previewScroll.codeBlock.shown.value" @close="previewScroll.codeBlock.close" />
    <PreviewCopiedNotice v-if="previewScroll.codeBlock?.copied.value" :notice="previewScroll.codeBlock.copied.value" />
  </div>
</template>
