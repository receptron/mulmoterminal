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
import { expandedPaths, restoreLevels } from "./filesTreeState";
import { ROOT_ROW, useFilesTree, type TreeNode } from "../composables/useFilesTree";
import { useOpenFile } from "../composables/useOpenFile";
import { useFilesReveal } from "../composables/useFilesReveal";
import { useFilesPreviewWire } from "../composables/useFilesPreviewWire";
import PreviewCodeBlockDialog from "./PreviewCodeBlockDialog.vue";
import type { FilesPaneState } from "./filesPaneState";
import { useFilesTabs } from "../composables/useFilesTabs";
import { tabLabels } from "./filesTabs";
import { nextTabIndex } from "./tabKeys";
import { previewLinkTarget } from "./previewLinkTarget";
import { fileMediaKind, previewFollowsAppTheme } from "./filePreviewKind";
import FilesMediaView from "./FilesMediaView.vue";
import { GIT_LETTER, gitDecorations } from "./filesGitDecorations";
import type { FileGitState } from "../../common/fileGitStatus";
import { useFilesGitStatus } from "../composables/useFilesGitStatus";
import { useFileHeadText } from "../composables/useFileHeadText";
import { rawFileSrc } from "./filesPreviewSrc";
import FileFinder from "./FileFinder.vue";
import FilesTreeEmpty from "./FilesTreeEmpty.vue";
import DirConfigSaveNote from "./DirConfigSaveNote.vue";
import FileSearch from "./FileSearch.vue";
import { useFileSearchPanel } from "../composables/useFileSearchPanel";
import { useFileTreeWidth } from "../composables/useFileTreeWidth";
import { clippedNameTip } from "./fileTreeWidth";
import FilesToolbarButton from "./FilesToolbarButton.vue";
import { canOpenInCanvas, absoluteUnder, type StoriesRoots } from "../composables/canvasOpenFile";
import { filesRowActions, type FilesRowAction } from "./filesRowActions";
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
import { useSideBySide } from "../composables/useSideBySide";
import { useFileHistory } from "../composables/useFileHistory";
import { useRequestedOpen } from "../composables/useRequestedOpen";
import FilesHistoryMenu from "./FilesHistoryMenu.vue";
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
}>();
const emit = defineEmits<{ close: []; dirty: [boolean]; "open-in-canvas": [path: string]; "insert-text": [text: string] }>();

// The tree is its own thing now (#2158): what has been read, what is expanded, what is on screen.
// The markup for it stays here.
const tree = useFilesTree(() => props.cwd);
// And so is the open file: the buffer, the editor it is shown in, the reader's place in it, and
// every way it is written back. Destructured because the template names these directly.
const file = useOpenFile(() => props.cwd);
const { openPath, openName, dirty, editSeq, saving, fileError, unpreviewable, conflict, showPreview, previewKind, previewSrc, dirConfigReport } = file;
// A picture, PDF, video or sound: no text to edit, so the "not text" panel shows the file itself (#2269, #2674).
const mediaKind = computed(() => (openPath.value ? fileMediaKind(openPath.value) : null));
const mediaSrc = computed(() => (openPath.value && mediaKind.value ? rawFileSrc(props.cwd, openPath.value, file.baseVersion.value) : ""));
const { flush, save, overwrite, discardAndReload, openInOs } = file;
// Which files are open as tabs, and which is in front (#2267). Every open below goes through it, so
// a path that already has a tab is brought forward rather than opened twice.
const tabs = useFilesTabs(file);
const { openAt, openRequested, openClicked } = useRequestedOpen(tabs, file);
const strip = tabs.strip;
// One tab is the pane as it always was — the header names the file. The strip is for two or more,
// and for a lone tab that is not on screen, which would otherwise have no control at all.
const showStrip = computed(() => strip.value.tabs.length > 1 || strip.value.tabs.some((tab) => tab.path !== openPath.value));
// The one tab in the Tab order: the front one, or the first when none is in front — a strip whose
// tabs are all -1 cannot be reached from the keyboard.
const focusablePath = computed(() => strip.value.activePath ?? strip.value.tabs[0]?.path ?? null);
const labels = computed(() => tabLabels(strip.value.tabs.map((tab) => tab.path)));
// Whether the Canvas has a View for the open file — the plugins' own gates decide, not an
// extension test here (see canvasOpenFile.ts).
// Gated on the path the CARD will carry, not the row's relative one: a cell whose directory has a
// dot segment (`~/.config/proj`) makes `p.html` pass here and the joined path fail the plugin's
// own guard, which is a button that does nothing when pressed.
const NO_ROOTS: StoriesRoots = { workspaces: [], roots: [] };
const storiesRoots = computed<StoriesRoots>(() => props.storiesRoots ?? NO_ROOTS);
const canvasOpenable = computed(() => canOpenInCanvas(openPath.value ? absoluteUnder(props.cwd, openPath.value) : null, storiesRoots.value));

const editorHost = ref<HTMLDivElement>();

// Preview is an iframe the pane cannot read into, so where the reader is in it arrives by message
// from the document's own reporter — and goes back the same way when that document reloads.
const previewScroll = useFilesPreviewWire(file, openPreviewLink, () => props.cwd);

// A Markdown file's headings, to go to one in the editor or the Preview (#2576).
const outline = useFileOutline({ editor: file.editor, showPreview, goToPreviewHeading: previewScroll.goToHeading });
const sideBySide = useSideBySide({ file, editorHost, preview: previewScroll });

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
  const deps = { file, hasTarget: () => !!props.insertTarget, cwd: () => props.cwd, terminalCwd: () => props.insertTargetCwd ?? null };
  const text = await selectionReferenceText(deps);
  if (text !== null) emit("insert-text", text);
  return text !== null;
}

/** What picking one does — the other end that belongs to this pane, because it emits. */
function runRowAction(action: FilesRowAction): void {
  // The Canvas entry carries the row's path, not text for the terminal — and it goes out on the
  // SAME emit as the header button, relative to the tree's root, so the receiver resolves it once.
  if (action.id === "open-canvas") emit("open-in-canvas", action.pathRel);
  else if (action.id === "open-tab") void tabs.open(action.pathRel, true);
  // Not an emit: nothing above this pane takes part. The browser cannot open a file manager, so
  // the local server does it (#2039) — through filesPaneApi, like every other request here.
  else if (action.id === "reveal") void file.reportFailure(askTheMachine("/api/files/reveal", action.pathAbs, `could not show ${action.pathAbs}`));
  else if (action.id === "insert-relative" || action.id === "insert-absolute") emit("insert-text", action.text);
  else if (isTreeOpAction(action)) void fileOps.run(action);
}

// New, rename and Trash from the row menu (#2578); the browser's own dialogs ask for the name.
const focusRow = (p: string) => focusTreeRow(treeEl.value, p);
const fileOps = useTreeFileOps({ cwd: () => props.cwd, tree, tabs, file, t, focusRow, changed: () => void gitStatus.refresh() });

const { menu: rowMenu, ...rowMenuApi } = useFilesRowMenu<TreeNode>({ menuEl: rowMenuEl, actionsFor: rowActionsFor, run: runRowAction });
// The menu on the tree's empty space and in an empty folder: the root as a row (#2694).
const rootMenu = menuAttrsFor(rowMenuApi, ROOT_ROW);

// Cmd/Ctrl+click asks for a tab of its own, as it asks a browser for one; a plain click replaces
// the front tab, as it replaced the one open file before tabs.
// The name as a tip only when the row cuts it off. Set on the row's own pointerover / focusin, which
// run before the document listeners that read `data-tip`, so the tip sees the width as it is now.
function tipIfClipped(name: string, event: Event): void {
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  const tip = clippedNameTip(row.querySelector<HTMLElement>("[data-row-name]"), name);
  if (tip === null) row.removeAttribute("data-tip");
  else row.setAttribute("data-tip", tip);
}

async function openFile(node: TreeNode, event: MouseEvent): Promise<void> {
  if (node.dir) return tree.toggleDir(node);
  await tabs.open(node.path, event.metaKey || event.ctrlKey);
}

const stripEl = useTemplateRef<HTMLElement>("stripEl");

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
  const front = strip.value.tabs.findIndex((entry) => entry.path === strip.value.activePath);
  const tab = stripEl.value?.querySelectorAll<HTMLElement>('[role="tab"]')[front];
  const editor = showPreview.value ? null : editorHost.value?.querySelector<HTMLElement>('[contenteditable="true"]');
  (tab ?? editor ?? treeEl.value?.querySelector<HTMLElement>("button"))?.focus();
}

const treeEl = useTemplateRef<HTMLElement>("treeEl");

// What git sees under the root (#2496), read again whenever the open file's version moves — a save
// or an outside change landing — as well as on its own period.
const gitStatus = useFilesGitStatus(() => props.cwd);
const git = computed(() => gitDecorations(gitStatus.files.value));
watch(file.baseVersion, () => void gitStatus.refresh());

// The open file's changes against HEAD, beside its lines (#2497): read again whenever the open file
// is read, and whenever what git sees moves — an agent's commit changes HEAD without touching the file.
const head = useFileHeadText({ cwd: () => props.cwd, openPath, unpreviewable, editor: file.editor });
// The path as well as the version: two files with the same content share a version, and switching
// between them moves only the path.
watch([openPath, file.baseVersion], () => void head.refresh());
watch(gitStatus.files, () => void head.refresh());
// Removed lines shown in place, as a unified diff, rather than marks alone — the reader's choice
// for the whole pane, kept as they move between files.
const showChanges = ref(false);
watch(showChanges, (on) => file.editor.value?.setShowChanges(on));
// The file's earlier versions (#2574), compared through the same marks and restored as an edit.
const history = useFileHistory({ cwd: () => props.cwd, openPath, editor: file.editor, head, showChanges, dirty, saving });
// Preview hides the menu's button; the menu must not come back by itself on returning to Edit.
watch(showPreview, () => history.close());
// A table rather than a key built from the state, so every key is written out where it is used.
const GIT_TIP: Record<FileGitState, string> = {
  modified: "tips.panes.git.modified",
  added: "tips.panes.git.added",
  untracked: "tips.panes.git.untracked",
  deleted: "tips.panes.git.deleted",
  renamed: "tips.panes.git.renamed",
};
/** A changed row's mark: its letter, its words, and its colour — amber for a change, green for
 *  something new, as VS Code's explorer colours them. */
const gitMark = (node: TreeNode): { letter: string; tip: string; tone: string } | null => {
  const state = git.value.stateOf(node.path);
  if (!state) return null;
  return { letter: GIT_LETTER[state], tip: t(GIT_TIP[state]), tone: state === "modified" ? "text-amber" : "text-ok" };
};

async function reloadTree(): Promise<void> {
  void gitStatus.refresh();
  await tree.loadRoot();
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
  showInTree,
  reset: resetReveal,
} = useFilesReveal({
  tree,
  treeEl,
  started: () => started,
  open: (pathRel) => tabs.open(pathRel),
  openPath,
});

// "Search in files" (#2140) — the finder's companion, and its own panel for the reason its own
// header says: the rows are a file heading with matching lines under it, not one row per path.
// The editor is passed as a GETTER because the pane replaces it when the host element remounts.
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
  // Every generation, not only the file's: a read already in flight would otherwise land after the
  // re-root and adopt the OLD project's content into the new tree, because its own generation check
  // still passes (Codex on #2102). Invalidating ALL of them is what makes "the pane is being torn
  // down" stop the work, rather than each request's own successor — so all three say so here.
  restored = false;
  resetReveal();
  gitStatus.reset();
  file.teardown();
  tabs.reset();
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

// Whether the remembered pane has been put back. Until then the tree is being restored to where the
// reader LEFT it — its expanded folders and its scroll (#2156) — and following the front tab would
// scroll it somewhere else.
let restored = false;

// The tree follows the tab in front, as VS Code's explorer follows the active editor (#2495): its
// folders open and its row comes into view. A row already on screen — the one just clicked — stays.
watch(
  () => strip.value.activePath,
  (pathRel) => {
    if (pathRel && restored) void showInTree(pathRel);
  },
);

async function start(): Promise<void> {
  const reqIdAtStart = file.generation();
  await nextTick();
  if (editorHost.value) file.attach(editorHost.value);
  // A re-root makes a new editor, which knows nothing of the reader's choice.
  file.editor.value?.setShowChanges(showChanges.value);
  void gitStatus.refresh();
  await tree.loadRoot();
  await restore(props.initialState ?? null, reqIdAtStart);
  restored = true;
  // An explicitly requested path wins over whatever was remembered — it is the more recent
  // intent (a clicked path in terminal output).
  if (props.requestedPath) void openRequested(props.requestedPath, props.requestedLocation ?? null);
}

/** Put a remembered tree back: open its directories parents-first (each fetches its children),
 *  then the file that was open. Anything since deleted simply isn't found and is skipped.
 *  `reqIdAtStart` is the read generation at the beginning of start() — restore only
 *  opens the remembered file when no competing request arrived during THIS startup cycle. */
async function restore(state: FilesPaneState | null, reqIdAtStart: number): Promise<void> {
  if (!state) return;
  // One wait per DEPTH, not one per directory. A level can only be looked up once the level above
  // it has its children, so the levels stay sequential — but siblings within a level are
  // independent fetches into their own nodes, and awaiting them one at a time was the whole of the
  // delay this pane was reported for (#2148).
  for (const level of restoreLevels(state.expanded)) {
    await Promise.all(
      level.map(async (dirPath) => {
        const node = tree.findNode(dirPath);
        if (node?.dir && !node.expanded) await tree.toggleDir(node);
      }),
    );
  }
  await tabs.restore({ tabs: state.tabs, activePath: state.activePath }, () => file.generation() === reqIdAtStart);
  // Last, and only after a tick: the rows have to exist before there is anything to scroll past,
  // and the expansions above are what create them.
  if (state.treeScrollTop !== undefined) {
    await nextTick();
    if (treeEl.value) treeEl.value.scrollTop = state.treeScrollTop;
  }
}

// A second clicked path while the pane is already showing: nothing else changes, so
// without this the file would never open.
// Keyed by value: the route rebuilds the location object on every navigation, and a change of
// `?cwd=` alone must not re-open the same path at the same line in the old root.
watch(
  () => JSON.stringify([props.requestedPath ?? null, props.requestedLocation ?? null]),
  () => {
    if (props.requestedPath) void openRequested(props.requestedPath, props.requestedLocation ?? null);
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
    ...tabs.current(),
    expanded: expandedPaths(tree.roots.value ?? []),
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
  openFile: (pathRel: string, location?: FileLocation) => (location ? openAt(pathRel, location, false) : openClicked(pathRel)),
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
      <span v-if="openPath && !showStrip" class="min-w-0 truncate font-mono text-[12px]" :class="dirty ? 'text-fg' : 'text-secondary'"
        >{{ openName }}<span v-if="dirty" class="ml-1 text-amber" :data-tip="t('tips.panes.unsaved')">●</span></span
      >
      <FilesViewModeButtons
        v-if="openPath && previewKind && previewSrc"
        v-bind="{ showPreview, saving, canSideBySide: previewKind === 'markdown' && !unpreviewable, sideBySide: sideBySide.active.value }"
        @toggle-preview="file.togglePreview()"
        @toggle-side-by-side="sideBySide.toggle()"
      />
      <button
        v-if="openPath && head.hasOriginal.value && !showPreview && !unpreviewable"
        type="button"
        data-testid="files-changes-btn"
        class="h-[26px] cursor-pointer rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-hover hover:text-fg"
        :class="showChanges ? 'bg-selected text-fg' : 'bg-base text-secondary'"
        :aria-pressed="showChanges"
        :data-tip="t('tips.panes.showChanges')"
        @click="showChanges = !showChanges"
      >
        Changes
      </button>
      <FilesOutlineMenu
        v-if="openPath && previewKind === 'markdown' && !unpreviewable"
        :key="`${openPath}:${showPreview}`"
        v-bind="outline.menu.value"
        @opened="outline.refresh()"
        @pick="outline.pick"
      />
      <FilesHistoryMenu
        v-if="openPath && !showPreview && !unpreviewable && !conflict"
        v-bind="history.menu.value"
        @toggle="history.toggle()"
        @close="history.close()"
        @compare="history.compare"
        @restore="history.restore"
      />
      <!-- Only where there is a cell to open it beside: this pane is also mounted full-screen by
           FilesOverlay, which has no enlarged terminal and so nothing to put a Canvas next to. -->
      <button
        v-if="canvasTarget && canvasOpenable"
        type="button"
        data-testid="files-canvas-btn"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :data-tip="t('tips.panes.openInCanvas')"
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
      <FilesToolbarButton icon="search" :label="t('tips.panes.findByName')" test-id="files-find-btn" opens-a-panel @click="openFinder()" />
      <FilesToolbarButton icon="manage_search" :label="t('tips.panes.searchInFiles')" test-id="files-search-btn" opens-a-panel @click="openSearch()" />
      <FilesToolbarButton
        v-if="insertTarget && openPath && !unpreviewable"
        icon="alternate_email"
        :label="t('tips.panes.insertSelection')"
        test-id="files-insert-selection"
        @click="insertSelection"
      />
      <FilesToolbarButton icon="refresh" :label="t('tips.panes.reloadTree')" @click="reloadTree" />
      <FilesToolbarButton icon="right_panel_close" :label="t('tips.panes.closeFiles')" @click="requestClose" />
    </header>
    <!-- The strip follows the collection chat's: a row under the header, small tabs, the front one
         in the selected colour. Each tab and its close button are siblings inside one pill, because a
         button cannot hold a button. -->
    <div
      v-if="showStrip"
      ref="stripEl"
      data-testid="files-tabs"
      role="tablist"
      class="flex flex-none items-center gap-1 overflow-x-auto border-b border-border px-2 py-1 font-sans text-[12px] text-dim"
      :aria-label="t('tips.panes.fileTabs')"
    >
      <div
        v-for="(tab, index) in strip.tabs"
        :key="tab.path"
        role="presentation"
        class="flex flex-none items-center rounded"
        :class="tab.path === strip.activePath ? 'bg-selected text-fg' : 'text-dim hover:text-fg'"
        @mousedown.middle.prevent
        @auxclick.middle="tabs.close(tab.path)"
      >
        <button
          type="button"
          role="tab"
          data-testid="files-tab"
          :data-path="tab.path"
          :aria-selected="tab.path === strip.activePath"
          :tabindex="tab.path === focusablePath ? 0 : -1"
          :data-tip="tab.path"
          class="flex cursor-pointer items-center gap-1 border-0 bg-transparent py-0.5 pl-2 pr-1 font-mono text-[12px] text-inherit"
          @click="tabs.open(tab.path)"
          @keydown="onTabKey($event, index)"
        >
          {{ labels[index]
          }}<span v-if="tab.path === openPath && dirty" class="text-amber"
            ><span aria-hidden="true">●</span><span class="sr-only">{{ t("tips.panes.unsaved") }}</span></span
          >
        </button>
        <button
          type="button"
          tabindex="-1"
          data-testid="files-tab-close"
          class="mr-0.5 flex cursor-pointer items-center rounded border-0 bg-transparent p-0 text-[13px] leading-none text-inherit hover:bg-hover"
          :data-tip="t('tips.panes.closeTab')"
          :aria-label="t('tips.panes.closeTabNamed', { name: labels[index] })"
          @click="tabs.close(tab.path)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
    <!-- In the flow, not over the editor: it stays up for the whole comparison, and a bar laid over
         the text would hide line 1 — often the very change being compared. -->
    <FilesComparingBanner
      v-if="!conflict && history.comparing.value && !showPreview && !unpreviewable"
      :at="history.comparing.value.entry.at"
      :failed="history.restoreFailed.value"
      @restore="history.comparing.value && history.restore(history.comparing.value.entry)"
      @stop="head.stopComparing()"
    />
    <div class="flex min-h-0 flex-auto">
      <nav ref="treeEl" class="shrink-0 grow-0 overflow-auto py-1.5" :style="treeStyle()" :aria-label="t('tips.panes.fileTree')" v-bind="rootMenu">
        <p v-if="tree.error.value" class="p-4 text-[13px] text-err">{{ tree.error.value }}</p>
        <p v-else-if="tree.roots.value === null" data-testid="files-tree-loading" class="p-4 text-[13px] text-muted">Loading…</p>
        <FilesTreeEmpty v-else-if="tree.roots.value.length === 0" :actions="rowActionsFor(ROOT_ROW)" @run="runRowAction" @menu="rootMenu.onContextmenu" />
        <button
          v-for="{ node, depth } in tree.rows.value"
          :key="node.path"
          type="button"
          data-testid="files-row"
          :data-path="node.path"
          class="flex w-full cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent px-2 py-[3px] text-left font-mono text-[12px]"
          :class="node.path === openPath ? 'bg-hover text-fg' : 'text-secondary hover:bg-hover hover:text-fg'"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          @click="openFile(node, $event)"
          @pointerover="tipIfClipped(node.name, $event)"
          @focusin="tipIfClipped(node.name, $event)"
          @contextmenu="rowMenuApi.open(node, $event)"
          @keydown="rowMenuApi.onRowKeydown(node, $event)"
        >
          <span class="w-3.5 flex-none text-dim">
            <span v-if="node.dir" class="material-symbols-outlined" aria-hidden="true">{{ node.expanded ? "expand_more" : "chevron_right" }}</span>
          </span>
          <span class="material-symbols-outlined flex-none" aria-hidden="true">{{ node.dir ? "folder" : "description" }}</span>
          <span class="truncate" data-row-name :class="gitMark(node)?.tone">{{ node.name }}</span>
          <!-- What git sees, as VS Code's explorer shows it: a letter for a changed file, a dot for a
               folder holding changes, so a collapsed tree still says where to look (#2496). -->
          <span
            v-if="gitMark(node)"
            role="img"
            class="ml-auto flex-none pl-2 text-[11px]"
            :class="gitMark(node)?.tone"
            :data-tip="gitMark(node)?.tip"
            :aria-label="gitMark(node)?.tip"
            >{{ gitMark(node)?.letter }}</span
          >
          <span
            v-else-if="node.dir && git.holdsChanges(node.path)"
            role="img"
            class="ml-auto flex-none pl-2 text-[9px] text-amber"
            :data-tip="t('tips.panes.git.holdsChanges')"
            :aria-label="t('tips.panes.git.holdsChanges')"
            >●</span
          >
        </button>
      </nav>
      <div
        data-testid="files-tree-splitter"
        class="w-[5px] flex-none cursor-col-resize bg-border hover:bg-accent focus-visible:bg-accent"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('tips.panes.fileTreeResize')"
        :aria-valuenow="treeWidth"
        :aria-valuemin="treeMin"
        :aria-valuemax="treeMax"
        tabindex="0"
        @pointerdown.prevent="onTreeSplitterDown"
        @keydown="onTreeSplitterKey"
      />
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
        <DirConfigSaveNote v-if="dirConfigReport && openPath" :report="dirConfigReport" @dismiss="dirConfigReport = null" />
        <p v-if="!openPath" class="m-auto p-4 text-[13px] text-muted">Select a file to view or edit.</p>
        <!-- Not text. The editor is hidden rather than shown empty: an empty buffer over a file
             that has content is an invitation to save, and saving is what destroyed it (#2038). -->
        <div
          v-else-if="unpreviewable"
          class="flex flex-col items-center gap-2 p-4 text-center"
          :class="mediaKind === 'pdf' ? 'min-h-0 flex-auto self-stretch' : 'm-auto'"
          data-testid="files-unpreviewable"
        >
          <FilesMediaView v-if="mediaKind" :kind="mediaKind" :src="mediaSrc" :name="openName" />
          <template v-else>
            <span class="material-symbols-outlined text-[28px] text-muted" aria-hidden="true">draft</span>
            <p class="text-[13px] text-muted">{{ unpreviewable }}</p>
          </template>
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
          v-show="openPath && !unpreviewable && (showPreview || sideBySide.active.value)"
          ref="previewFrame"
          :key="previewKind === 'markdown' ? 'markdown' : 'page'"
          class="flex-auto border-0"
          :class="[previewFollowsAppTheme(previewKind) ? 'bg-[var(--bg-base)]' : 'bg-white', sideBySide.previewClass.value]"
          :src="previewKind === 'markdown' || showPreview ? previewSrc : ''"
          sandbox="allow-scripts"
          :title="previewKind === 'markdown' ? t('tips.panes.markdownPreview') : t('tips.panes.filePreview')"
        />
        <div v-show="openPath && !unpreviewable && !showPreview" ref="editorHost" :class="sideBySide.editorClass.value" />
      </section>
    </div>
    <FileFinder v-if="finderOpen" :cwd="cwd" :seed="finderSeed" @pick="onFinderPick" @close="closeFinder" />
    <FileSearch v-if="search.open.value" :cwd="cwd" :buffer="search.buffer.value" :seed="searchSeed" @pick="search.onPick" @close="search.close" />
    <Teleport to="body">
      <div
        v-if="rowMenu"
        ref="rowMenuEl"
        data-testid="files-row-menu"
        role="menu"
        class="fixed z-[60] min-w-[200px] rounded-lg border border-border bg-panel p-1.5 text-fg shadow-xl"
        :style="{ top: `${rowMenu.top}px`, left: `${rowMenu.left}px` }"
        @keydown="rowMenuApi.onMenuNav"
      >
        <button
          v-for="action in rowMenu.actions"
          :key="action.id"
          type="button"
          role="menuitem"
          :data-testid="`files-row-action-${action.id}`"
          class="flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] text-secondary hover:bg-hover hover:text-fg"
          @click="rowMenuApi.pick(action)"
        >
          <span class="material-symbols-outlined text-[15px]" aria-hidden="true">{{ action.icon }}</span> {{ t(action.labelKey) }}
        </button>
      </div>
    </Teleport>
    <PreviewCodeBlockDialog v-if="previewScroll.codeBlock?.shown.value" :lookup="previewScroll.codeBlock.shown.value" @close="previewScroll.codeBlock.close" />
  </div>
</template>
