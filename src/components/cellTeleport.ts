// Where a cell's terminal is SHOWN, when it is not in its own tile (#2001).
//
// Two things move a cell without re-creating it: enlarging it (into `.zoom-main`) and the
// collection pane (into the receptacle under the collection). Both are one `<Teleport>`, so the
// precedence between them has to be stated once, here, rather than read out of a nested ternary in
// the template.
//
// The pane wins. It is a full-screen overlay ON TOP of the grid, so whatever the grid is doing
// underneath — zoomed or tiled — is not what the user is looking at.

export type CellPlacement = "tile" | "zoom" | "collection";

export function cellPlacement(opts: { claimedByCollection: boolean; zoomed: boolean; expanded: boolean }): CellPlacement {
  if (opts.claimedByCollection) return "collection";
  return opts.zoomed && opts.expanded ? "zoom" : "tile";
}

/** The `v-for` key for one cell's teleport.
 *
 *  It carries the PLACEMENT, not just the cell, because a `<Teleport>` that changes target while it
 *  is DISABLED keeps the old one: re-enabling it later moves the cell into a node that has since
 *  left the document, and nothing brings it back — enlarging a chat's cell after a visit to its
 *  collection lost the terminal entirely (found by running it, PR #2002).
 *
 *  Only the collection trip re-keys. Tile ↔ zoom keeps one teleport, so the grid's FLIP animation
 *  still measures and moves the same elements. What a re-key costs is a remount of the CELL, and
 *  the terminal survives that by design: its slot is durable, so `attach` re-parents the same xterm
 *  instead of reconnecting. */
export const teleportKey = (uid: number, placement: CellPlacement): string | number => (placement === "collection" ? `${uid}:pane` : uid);
