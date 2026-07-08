// A click on a grid cell's header background zooms (promotes) that cell — but ONLY
// while it's a filmstrip thumbnail (some OTHER cell is already zoomed), where this is
// the easy "switch to that terminal" gesture. In the normal grid the header is inert;
// the ⤢ button is the only way to zoom. The header's own controls (dir / GitHub / ⤢ /
// ✕ / ◀▶) always keep their action.
export function shouldZoomOnHeaderClick(target: EventTarget | null, filmstrip: boolean): boolean {
  if (!filmstrip) return false;
  // `Element` (not `HTMLElement`): a click can land on an SVG icon inside a button
  // (e.g. the GitHub button), and SVGElement isn't an HTMLElement — but it IS an
  // Element with closest(), so this still walks up to the enclosing button.
  return !(target instanceof Element && target.closest("button"));
}
