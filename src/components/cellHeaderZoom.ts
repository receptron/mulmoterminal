// A click on a grid cell's header background zooms (promotes) that cell to fill the
// grid — in BOTH the tiled grid and while it's a filmstrip thumbnail (some other cell
// is already zoomed), the easy "switch to this terminal" gesture that mirrors clicking
// the terminal body. The EXPANDED cell itself is excluded: its header stays inert so a
// stray click while reading the big terminal doesn't restore it (use the restore button).
// The header's own controls (dir / GitHub / expand / close / move) always keep their action.
//
// `zoomSuppressed` is the same answer as hiding the expand BUTTON, applied to the gesture: while
// the collection pane holds this cell the zoom happens behind an overlay, so a header click would
// change a state nobody can see until they leave. Removing the button without this leaves the
// invisible zoom one stray click away (CodeRabbit, PR #2002).
export function shouldZoomOnHeaderClick(target: EventTarget | null, expanded: boolean, zoomSuppressed = false): boolean {
  if (expanded || zoomSuppressed) return false;
  // `Element` (not `HTMLElement`): a click can land on an SVG icon inside a button
  // (e.g. the GitHub button), and SVGElement isn't an HTMLElement — but it IS an
  // Element with closest(), so this still walks up to the enclosing button.
  return !(target instanceof Element && target.closest("button"));
}
