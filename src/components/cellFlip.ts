// Zooming re-parents a cell between the grid slot and the zoom overlay in a single Vue
// patch — a move no CSS transition can interpolate. So we FLIP it: measure the cell
// before the patch and after it, then play the move backwards, starting from the
// transform that puts it back where it looked and animating to identity.
//
// Transform-only on purpose. It never touches the layout box, so xterm's ResizeObserver
// refits once (when the patch lands) rather than on every animation frame.

export type Rect = Pick<DOMRect, "left" | "top" | "width" | "height">;

export const FLIP_MS = 180;
export const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";

// After an expand/collapse teleports a cell (which blurs its xterm), should THIS cell grab keyboard
// focus? Yes when it became the big one (`expanded`), or when the grid fully collapsed (`!zoomed`) so
// it's the one returning to view. No when another cell is now the big one (still `zoomed`) — that
// cell claims focus instead. `expanded` is the cell's new state; `zoomed` = some cell is expanded.
export function shouldRefocusOnZoomChange(expanded: boolean, zoomed: boolean | undefined): boolean {
  return expanded || !zoomed;
}

// Under these thresholds the move reads as static, and animating it would buy a repaint
// and nothing else.
const MIN_SHIFT_PX = 1;
const MIN_SCALE_DELTA = 0.01;

const isImperceptible = (dx: number, dy: number, sx: number, sy: number) =>
  Math.abs(dx) < MIN_SHIFT_PX && Math.abs(dy) < MIN_SHIFT_PX && Math.abs(sx - 1) < MIN_SCALE_DELTA && Math.abs(sy - 1) < MIN_SCALE_DELTA;

// Null when there is nothing worth animating: a `last` of zero area means the cell isn't
// laid out yet, and scaling by its reciprocal would blank the cell for the whole flight.
export function flipKeyframes(first: Rect, last: Rect): Keyframe[] | null {
  if (last.width <= 0 || last.height <= 0) return null;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / last.width;
  const sy = first.height / last.height;
  if (isImperceptible(dx, dy, sx, sy)) return null;
  const origin = "top left";
  return [
    { transformOrigin: origin, transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transformOrigin: origin, transform: "none" },
  ];
}

// One cell's flight: where it was before the patch, where it is after. `flipKeyframes`
// turns each into a transform animation; a null result there means it didn't really move.
export interface FlipPair {
  uid: number;
  first: Rect;
  last: Rect;
}

// Which cells can fly when the grid expands or collapses: only those present BOTH before
// and after the patch. Expanding brings the other tabs' cells into the filmstrip — they
// have no "before", so they can't be inverted; collapsing drops them — they have no
// "after". Each surviving cell is paired with its own start and end rect, so every one of
// them animates, not just the cell being zoomed. Iterating `after` keeps the order stable.
export function flipPairs(before: Map<number, Rect>, after: Map<number, Rect>): FlipPair[] {
  const pairs: FlipPair[] = [];
  for (const [uid, last] of after) {
    const first = before.get(uid);
    if (first) pairs.push({ uid, first, last });
  }
  return pairs;
}
