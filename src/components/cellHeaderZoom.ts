// A click on a grid cell's header background zooms (promotes) that cell — while
// another cell is zoomed this is the easy "switch to that terminal" gesture. The
// header's own controls (dir / GitHub / ⤢ / ✕ / ◀▶) keep their action, and the
// already-zoomed cell ignores stray header clicks (it restores via its ⤡ button).
export function shouldZoomOnHeaderClick(target: EventTarget | null, expanded: boolean): boolean {
  if (expanded) return false;
  // `Element` (not `HTMLElement`): a click can land on an SVG icon inside a button
  // (e.g. the GitHub button), and SVGElement isn't an HTMLElement — but it IS an
  // Element with closest(), so this still walks up to the enclosing button.
  return !(target instanceof Element && target.closest("button"));
}
