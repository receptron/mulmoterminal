// A click on a grid cell's header background zooms (promotes) that cell — while
// another cell is zoomed this is the easy "switch to that terminal" gesture. The
// header's own controls (dir / GitHub / ⤢ / ✕ / ◀▶) keep their action, and the
// already-zoomed cell ignores stray header clicks (it restores via its ⤡ button).
export function shouldZoomOnHeaderClick(target: EventTarget | null, expanded: boolean): boolean {
  if (expanded) return false;
  return !(target instanceof HTMLElement && target.closest("button"));
}
