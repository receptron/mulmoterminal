// What is worth remembering about a file tree between visits, and in what order to put it
// back. Kept out of the component because it is all decisions — which nodes count, and the
// parents-before-children ordering a lazy tree needs — and none of it needs a mounted editor
// to be tested.

/** The shape the tree renders from; only the parts this module reasons about. */
export interface TreeNode {
  path: string;
  dir: boolean;
  expanded: boolean;
  children: TreeNode[];
}

/** Every directory currently open, deepest last. Files are not remembered — the tree only ever
 *  shows them under an open directory, so their parents already imply them. */
export function expandedPaths(nodes: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly TreeNode[]) => {
    list.forEach((node) => {
      if (!node.dir || !node.expanded) return;
      out.push(node.path);
      walk(node.children);
    });
  };
  walk(nodes);
  return out;
}

/** The order to re-open them in. Each expansion fetches that directory's children, so a child
 *  cannot be opened before its parent exists — depth-first order from a previous session is
 *  not enough on its own, because the remembered list may have been merged or truncated. */
export function restoreOrder(paths: readonly string[]): string[] {
  const depth = (p: string) => p.split("/").length;
  return [...new Set(paths)].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

/** The directories that have to be open for `pathRel` to be visible in the tree, outermost first
 *  — `a/b/c.ts` needs `a`, then `a/b`. Ordered because each expansion FETCHES that directory's
 *  children, so a child cannot be opened before its parent exists (the same rule `restoreOrder`
 *  exists for). A path at the root needs nothing. */
export function ancestorDirs(pathRel: string): string[] {
  const segments = pathRel.split("/").filter((segment) => segment !== "");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}
