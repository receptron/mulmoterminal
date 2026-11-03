// "Show me this file": open a path AND put the tree on it, plus the finder panel that is one way
// of asking for that. Lifted out of FilesPane.vue with the tree (#2169) and the open file (#2174)
// before it; the panel's markup stays in the pane, as theirs did.
//
// The two halves are here together because the finder has no other purpose: picking in it is a
// reveal, and the panel closes because the reveal is starting. Splitting them would leave two
// files whose only content is each other's call.
import { nextTick, ref, watch, type Ref, type ShallowRef } from "vue";
import { ancestorDirs } from "../components/filesTreeState";
import { isOutsidePath } from "../components/filesOutsidePath";
import type { FilesTree } from "./useFilesTree";

export interface FilesRevealDeps {
  tree: FilesTree;
  /** The pane's template ref for the scrolling tree container — this does not render it. */
  treeEl: Readonly<ShallowRef<HTMLElement | null>>;
  /** The pane's current startup, as a GETTER: `reload()` replaces the promise, and a reveal that
   *  captured the old one would wait for a tree that is no longer being built. */
  started: () => Promise<void>;
  /** Open the file itself — the other half of "reveal", which this does not own. */
  open: (pathRel: string) => Promise<void>;
  /** What the editor is REALLY showing, which is not always what was asked for. */
  openPath: Ref<string | null>;
  /** The path of the tab in front, which the tree follows (#2495). */
  frontPath: () => string | null;
}

export interface FilesReveal {
  finderOpen: Ref<boolean>;
  closeFinder: () => void;
  onFinderPick: (pathRel: string) => void;
  /** Open `pathRel` and scroll the tree to it. Returns whether the editor ended up on it. */
  revealPath: (pathRel: string) => Promise<boolean>;
  /** Put the tree on a file that is already open — the tab in front changed (#2495). Expands its
   *  folders and scrolls its row into view; opens nothing. */
  showInTree: (pathRel: string) => Promise<void>;
  /** Put the tree on a folder the folder view moved to: the folder opens too, so the tree shows
   *  what the view does. It goes on only while `stillShown` — a file opened, the view moved on, or the
   *  pane re-rooted, by whatever route, ends it. The root has no row: a move still under way stops. */
  showFolderInTree: (dirRel: string, stillShown: () => boolean) => Promise<void>;
  /** A click in the tree itself: a folder-view move still under way stops, even one into the very
   *  folder clicked, which `stillShown` cannot tell from the move. */
  stopShowing: () => void;
  /** The remembered pane is back: from now on the tree follows the tab in front, and it is put on
   *  that tab's row at once — the remembered scroll may have left the row off screen (#3058).
   *  False, and nothing done, for a startup a reset has since made stale. */
  followFrontTab: (startedAt: number) => boolean;
  /** Which startup this is, for `followFrontTab`: a reset makes every earlier one stale. */
  startEpoch: () => number;
  /** The pane is re-rooting: a reveal in flight must not scroll the new tree to a row from the
   *  project it just left, and the panel must not go on offering the old project's paths. */
  reset: () => void;
}

/** The tree row for a path. Found by walking the rendered rows rather than with an attribute
 *  selector: a path holds `"` and `\` as readily as any other character, and one would break a
 *  selector built by concatenation. Exported because that is the whole point of it and a mounted
 *  pane cannot easily be given a file named `a"b`. */
export function rowElementFor(treeEl: HTMLElement | null, pathRel: string): HTMLElement | undefined {
  return [...(treeEl?.querySelectorAll<HTMLElement>("[data-path]") ?? [])].find((el) => el.dataset.path === pathRel);
}

// The tree follows the tab in front, as VS Code's explorer follows the active editor (#2495): its
// folders open and its row comes into view. A row already on screen — the one just clicked — stays.
// Not while the remembered pane is being put back: its expanded folders (#2156) are where the reader
// LEFT the tree. Once it is back, the front row is brought into view only if those folders show it
// (#3058) — the remembered scroll may have left it off screen, but a folder they closed stays closed.
function followsFrontTab(
  frontPath: () => string | null,
  showInTree: (pathRel: string) => Promise<void>,
  scrollToRow: (pathRel: string) => void,
): { start: (startedAt: number) => boolean; stop: () => void; epoch: () => number } {
  let following = false;
  // A startup still running when the pane re-rooted must not switch following on in the new root.
  let epoch = 0;
  watch(frontPath, (pathRel) => {
    if (pathRel && following) void showInTree(pathRel);
  });
  return {
    start: (startedAt) => {
      if (startedAt !== epoch) return false;
      following = true;
      const pathRel = frontPath();
      if (pathRel) scrollToRow(pathRel);
      return true;
    },
    stop: () => {
      following = false;
      epoch += 1;
    },
    epoch: () => epoch,
  };
}

/** Expand `dirs` in order, stopping if `current` says a later call took over. */
async function expandAll(tree: FilesTree, dirs: readonly string[], current: () => boolean): Promise<boolean> {
  for (const dirPath of dirs) {
    const node = tree.findNode(dirPath);
    if (node?.dir && !node.expanded) await tree.toggleDir(node);
    if (!current()) return false;
  }
  return true;
}

export function useFilesReveal(deps: FilesRevealDeps): FilesReveal {
  // "Open by name" (#2099). Its own state rather than a route or a prop: the finder belongs to
  // whichever pane the user is in, and BOTH mounts of the pane have one — the pane beside a zoomed
  // cell, where a keymap action opens it, and the full-screen view, where the button is the way in.
  const finderOpen = ref(false);
  const closeFinder = (): void => {
    finderOpen.value = false;
  };

  // Which reveal is the current one. A reveal spends most of its time FETCHING — one request per
  // ancestor directory — so a second pick can overtake the first and finish before it. A read takes
  // the newest generation as it goes, so the loser landing second would replace the file the user
  // actually chose with the one they abandoned (CodeRabbit on #2102). Bumped by the pane's teardown
  // too: a re-rooted pane must not be scrolled to a row from the project it just left.
  let revealId = 0;
  // Its own count, not revealId: bringing a tab forward is what a reveal DOES, so sharing one count
  // would make every reveal cancel itself the moment its file came to the front.
  let showId = 0;

  /** Open `pathRel` and put the tree on it. The ancestors are expanded OUTERMOST FIRST because each
   *  expansion fetches that directory's children — a child cannot be opened before its parent has
   *  been (the rule `restoreLevels` exists for). */
  async function revealPath(pathRel: string): Promise<boolean> {
    const id = ++revealId;
    await deps.started(); // the tree may still be loading — expanding into an unread `roots` finds nothing
    if (id !== revealId) return false;
    // A later pick may take over while this one is fetching.
    if (!(await expandAll(deps.tree, ancestorDirs(pathRel), () => id === revealId))) return false;
    await deps.open(pathRel);
    await nextTick(); // the row only exists once the expansions above have rendered
    if (id !== revealId) return false;
    rowElementFor(deps.treeEl.value, pathRel)?.scrollIntoView({ block: "nearest" });
    // Whether the editor is REALLY showing what was asked for. `open` returns nothing and has
    // several ways to end without opening anything — the file is gone, the fetch failed, or it
    // declined to leave a dirty buffer that could not be saved — and in each the editor keeps the
    // previous document. A caller that goes on to scroll to a line number needs to know that, or it
    // scrolls an unrelated file to an arbitrary place while looking deliberate.
    return deps.openPath.value === pathRel;
  }

  /** Expand `dirs` outermost first and scroll to `rowPath`, giving way to a later call or to `wanted`
   *  turning false. */
  async function showRow(dirs: readonly string[], rowPath: string, wanted: () => boolean = () => true): Promise<void> {
    const id = ++showId;
    const current = (): boolean => id === showId && wanted();
    await deps.started();
    if (!current() || !(await expandAll(deps.tree, dirs, current))) return;
    await nextTick();
    if (current()) scrollToRow(rowPath);
  }
  // A file outside the root (#3238) has no row and no ancestors in this tree: its path's segments
  // would be read as folders under the root, and a folder that happens to share a name would open.
  // An outside file (#3238) has no ancestors here and no row — its segments must not be walked as
  // folders under the root — and still overtakes a reveal under way for the previous tab.
  const showInTree = (pathRel: string): Promise<void> => showRow(isOutsidePath(pathRel) ? [] : ancestorDirs(pathRel), pathRel);
  const showFolderInTree = async (dirRel: string, stillShown: () => boolean): Promise<void> => {
    if (dirRel) return showRow([...ancestorDirs(dirRel), dirRel], dirRel, stillShown);
    stopShowing(); // the root has no row, but a move to it still overtakes one under way
  };
  function stopShowing(): void {
    showId += 1;
  }
  // `nearest`: a row already on screen — the one just clicked — does not move.
  const scrollToRow = (pathRel: string): void => rowElementFor(deps.treeEl.value, pathRel)?.scrollIntoView({ block: "nearest" });

  const front = followsFrontTab(deps.frontPath, showInTree, scrollToRow);

  // Picking is "show me this file", not only "open it": the tree is how the user goes on to its
  // neighbours, and a file opened with the tree still collapsed leaves them where they started.
  function onFinderPick(pathRel: string): void {
    closeFinder();
    void revealPath(pathRel);
  }

  return {
    finderOpen,
    closeFinder,
    onFinderPick,
    revealPath,
    showInTree,
    showFolderInTree,
    stopShowing,
    followFrontTab: front.start,
    startEpoch: front.epoch,
    reset: () => {
      front.stop();
      revealId += 1;
      showId += 1;
      closeFinder();
    },
  };
}
