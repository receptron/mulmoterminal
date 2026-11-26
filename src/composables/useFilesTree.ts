// The Files pane's directory tree: what has been read, what is expanded, and what is on screen.
// Lifted out of FilesPane.vue, which sits at the repo's file-length limit and had two more features
// queued behind it (#2158). The pane keeps the markup — this is the half that fetches and decides.
//
// It owns three pieces of state that only make sense together: the forest (`null` until a listing
// comes back, because an empty ARRAY has to mean "the directory is empty"), the error that replaces
// it, and the request generation that decides which answer is still wanted.
import { computed, ref, type ComputedRef, type Ref } from "vue";
import { cacheListing, cachedListingFor, type ListingEntry } from "../components/filesTreeCache";
import { browseQuery, browseUrl } from "../components/filesPaneApi";
import { dirKeyOf } from "./dirAddress";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

export interface TreeNode {
  name: string;
  path: string; // relative to the project root
  dir: boolean;
  size: number;
  expanded: boolean;
  loaded: boolean;
  children: TreeNode[];
}

/** The tree's root as if it were a row — what a menu opened on no row, or in an empty folder, acts on. */
export const ROOT_ROW: TreeNode = { name: "", path: "", dir: true, size: 0, expanded: true, loaded: true, children: [] };

/** One visible row: a node and how deep it sits, so the template renders a flat list rather than a
 *  recursive component. */
export interface TreeRow {
  node: TreeNode;
  depth: number;
}

// The listing arrives off the wire, so an entry is checked before it becomes one — the tree renders
// `name` and branches on `dir`, and a malformed entry would render as blank rather than as absent.
const isListingEntry = (value: unknown): value is ListingEntry =>
  isRecord(value) && typeof value.name === "string" && typeof value.dir === "boolean" && typeof value.size === "number";

const makeNode = (entry: ListingEntry, parentPath: string): TreeNode => ({
  name: entry.name,
  path: parentPath ? `${parentPath}/${entry.name}` : entry.name,
  dir: entry.dir,
  size: entry.size,
  expanded: false,
  loaded: false,
  children: [],
});

/** Depth-first flatten of the visible rows, descending only into expanded directories. */
export function flattenRows(nodes: TreeNode[]): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (level: TreeNode[], depth: number) => {
    for (const node of level) {
      out.push({ node, depth });
      if (node.dir && node.expanded) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

/** The node at `target`, anywhere in the forest. */
export function findIn(nodes: TreeNode[], target: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === target) return node;
    const hit = findIn(node.children, target);
    if (hit) return hit;
  }
  return null;
}

/** A fresh listing as nodes, carrying over any directory that was EXPANDED AND LOADED in `before`.
 *  Without that, a tree painted from the cache collapses under the user a round trip after they
 *  clicked it — which is exactly the window the cache exists to fill. What is carried is REAL:
 *  those children were fetched, whatever painted the parent. */
export function adoptListing(before: TreeNode[] | null, entries: ListingEntry[], parentPath = ""): TreeNode[] {
  const open = new Map((before ?? []).filter((node) => node.loaded).map((node) => [node.path, node]));
  return entries.map((entry) => {
    const node = makeNode(entry, parentPath);
    const was = open.get(node.path);
    if (was?.dir && node.dir) Object.assign(node, { children: was.children, loaded: true, expanded: was.expanded });
    return node;
  });
}

/** What a directory read needs of its tree: the nodes as they are NOW (a read lands on the node that
 *  holds the path by then, which an intervening read of its parent may have replaced), the root, and
 *  the two marks that say whether its answer is still wanted: the root generation, and how many
 *  times each directory has been asked for, so of two reads in flight for one directory the later
 *  one lands and the earlier is dropped, whoever asked. The Reload button and a file operation can
 *  ask at once, and the older answer must not undo the newer. */
interface TreeReads {
  roots: () => TreeNode[];
  cwd: () => string | null;
  host: () => string | null;
  generation: () => number;
  asked: Map<string, number>;
}

/** A directory's children read again, keeping what is open under it. One never opened is left
 *  alone, and one that cannot be read keeps the listing on screen. */
async function refreshDir(tree: TreeReads, dirRel: string): Promise<void> {
  const node = findIn(tree.roots(), dirRel);
  if (!node?.dir || !node.loaded) return;
  const generation = tree.generation();
  const read = (tree.asked.get(dirRel) ?? 0) + 1;
  tree.asked.set(dirRel, read);
  try {
    const entries = await fetchListing(tree.cwd(), dirRel, tree.host());
    if (generation !== tree.generation() || tree.asked.get(dirRel) !== read) return;
    const current = findIn(tree.roots(), dirRel);
    if (current?.dir && current.loaded) current.children = adoptListing(current.children, entries, dirRel);
  } catch {
    // The next open of the directory reads it again.
  }
}

/** Every directory already read under `nodes`, read again: parents first, so a child is found in its
 *  parent's fresh listing and one gone from the disk is not asked for. `wanted` says whether the
 *  tree being read is still the one on screen. */
async function refreshLoadedUnder(tree: TreeReads, nodes: TreeNode[], wanted: () => boolean): Promise<void> {
  for (const node of nodes.filter((child) => child.dir && child.loaded)) {
    if (!wanted()) return;
    await refreshDir(tree, node.path);
    const fresh = findIn(tree.roots(), node.path);
    if (fresh) await refreshLoadedUnder(tree, fresh.children, wanted);
  }
}

/** Open a closed directory, reading it the first time, or close an open one. */
async function toggleDir(tree: Pick<TreeReads, "cwd" | "host">, node: TreeNode): Promise<void> {
  node.expanded = !node.expanded;
  if (node.expanded && !node.loaded) {
    try {
      node.children = (await fetchListing(tree.cwd(), node.path, tree.host())).map((entry) => makeNode(entry, node.path));
      node.loaded = true;
    } catch {
      node.expanded = false; // couldn't read — collapse again
    }
  }
}

/** One directory's listing, off the wire: this machine's, or `host`'s. */
export async function fetchListing(cwd: string | null, pathRel: string, host: string | null = null): Promise<ListingEntry[]> {
  const res = await fetchWithTimeout(browseUrl(host, "list", browseQuery(cwd, pathRel)));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await jsonBody(res);
  // A directory with no children answers `{ entries: [] }`, so an ABSENT array is a body we could
  // not read — different from an empty directory, and the callers treat the two differently (one
  // marks the node loaded, the other collapses it again).
  if (!isUnknownArray(data.entries)) throw new Error("GET /api/files/browse/list → body has no entries array");
  return data.entries.filter(isListingEntry);
}

export interface FilesTree {
  /** `null` until a listing comes back for this root: an empty array means the directory is empty. */
  roots: Ref<TreeNode[] | null>;
  error: Ref<string | null>;
  rows: ComputedRef<TreeRow[]>;
  loadRoot: () => Promise<void>;
  toggleDir: (node: TreeNode) => Promise<void>;
  /** Read one directory again (the root for ""), keeping what is open under it (#2578). A directory
   *  that was never opened is left alone; it is read when it is. */
  refresh: (dirRel: string) => Promise<void>;
  /** The Reload button: the root, then every directory already read under it, open or collapsed. A
   *  collapsed one would otherwise show its old listing when next opened (#3215). One never opened is
   *  left alone. Stops when the root cannot be read, or when the pane has moved to another root. */
  refreshAll: () => Promise<void>;
  findNode: (target: string) => TreeNode | null;
  /** Nothing has been read for the root this pane is moving to. Bumps the generation too, so an
   *  answer already in flight cannot land in the new tree. */
  reset: () => void;
}

export function useFilesTree(cwd: () => string | null, host: () => string | null = () => null): FilesTree {
  const roots = ref<TreeNode[] | null>(null);
  const error = ref<string | null>(null);
  let reqId = 0;
  const reads: TreeReads = { roots: () => roots.value ?? [], cwd, host, generation: () => reqId, asked: new Map() };
  // Filed by host as well, so a remote directory never paints this machine's listing of the same path.
  const cacheKey = (): string | null => dirKeyOf(host(), cwd());

  /** Show this directory's last listing, if there is one. Says whether it painted, because what
   *  happens to it when the read fails is not what happens to a tree that was really read. */
  function paintCachedRoot(): boolean {
    const cached = cachedListingFor(cacheKey());
    if (!cached) return false;
    roots.value = cached.map((entry) => makeNode(entry, ""));
    return true;
  }

  async function loadRoot(): Promise<void> {
    const id = ++reqId;
    error.value = null;
    // Paint what this directory held last time, so the wait shows the tree rather than "Loading…".
    // Only when nothing is on screen: the header's Reload button comes through here with a real
    // tree already up, and replacing that with an older copy would be a step backwards (#2148).
    const painted = roots.value === null && paintCachedRoot();
    try {
      const entries = await fetchListing(cwd(), "", host());
      if (id === reqId) {
        roots.value = adoptListing(roots.value, entries);
        cacheListing(cacheKey(), entries);
      }
    } catch (e) {
      if (id !== reqId) return;
      error.value = e instanceof Error ? e.message : String(e);
      // A painted cache is a guess, and the error says we cannot confirm it — so it goes, and the
      // error stands alone. A tree that was really READ stays: that one we know was true once.
      if (painted) roots.value = null;
    }
  }

  async function refreshAll(): Promise<void> {
    const rootRead = loadRoot();
    const id = reqId; // before the await: a root change meanwhile ends this reload rather than lending it the new generation
    await rootRead;
    if (id !== reqId || error.value !== null || roots.value === null) return;
    await refreshLoadedUnder(reads, roots.value, () => id === reqId);
  }

  return {
    roots,
    error,
    rows: computed(() => flattenRows(roots.value ?? [])),
    loadRoot,
    toggleDir: (node) => toggleDir(reads, node),
    refresh: (dirRel) => (dirRel === "" ? loadRoot() : refreshDir(reads, dirRel)),
    refreshAll,
    findNode: (target) => findIn(roots.value ?? [], target),
    reset: () => {
      reqId += 1;
      reads.asked.clear();
      roots.value = null;
      error.value = null;
    },
  };
}
