// A click on a grid cell's header background zooms (promotes) that cell to fill the
// grid — in BOTH the tiled grid and while it's a filmstrip thumbnail (some other cell
// is already zoomed), the easy "switch to this terminal" gesture that mirrors clicking
// the terminal body. The EXPANDED cell itself is excluded: its header stays inert so a
// stray click while reading the big terminal doesn't restore it (use the ⤡ button).
// The header's own controls (dir / GitHub / ⤢ / ✕ / ◀▶) always keep their action.
export function shouldZoomOnHeaderClick(target: EventTarget | null, expanded: boolean): boolean {
  if (expanded) return false;
  // `Element` (not `HTMLElement`): a click can land on an SVG icon inside a button
  // (e.g. the GitHub button), and SVGElement isn't an HTMLElement — but it IS an
  // Element with closest(), so this still walks up to the enclosing button.
  return !(target instanceof Element && target.closest("button"));
}
