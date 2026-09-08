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
