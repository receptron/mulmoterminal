// Where a dropdown anchored to a button can actually fit, and how tall it may be.
//
// A CSS-only cap cannot answer this. `max-h-[50vh]` bounds the menu against the WINDOW, but the
// menu hangs off a trigger partway down the screen, so the height it is allowed and the height
// that fits below it are different numbers — and on the bottom row of a 20-cell grid the second
// one is nearly zero. That is why #2003's menu still ran off the screen with a cap on it.
//
// Its own file, and pure: the decision is arithmetic on a rectangle, so it is worth testing
// without a browser. The caller supplies the rect and the viewport; nothing here touches the DOM.

/** Never offer less than this. Below it a menu is a scrollbar with a hint of content, and the
 *  caller is better off flipping to the other side even if that side is also tight. */
export const MIN_MENU_HEIGHT_PX = 220;

/** Breathing room between the menu and the window edge, so the last row is not flush. */
export const MENU_VIEWPORT_GAP_PX = 12;

export interface MenuPlacement {
  /** Open upward (anchored to the trigger's top) rather than downward. */
  up: boolean;
  /** The tallest the menu may be on the side chosen, in CSS pixels. */
  maxHeightPx: number;
}

/**
 * Decide which side of `trigger` a dropdown opens on, and its height budget there.
 *
 * Downward unless below is cramped AND above is roomier — a menu that jumps sides for a few
 * pixels is worse than one that scrolls, so the flip needs a real reason.
 */
export function menuPlacement(trigger: { top: number; bottom: number }, viewportHeight: number): MenuPlacement {
  const below = viewportHeight - trigger.bottom - MENU_VIEWPORT_GAP_PX;
  const above = trigger.top - MENU_VIEWPORT_GAP_PX;
  const up = below < MIN_MENU_HEIGHT_PX && above > below;
  // `Math.max(0, …)` so a trigger scrolled off-screen cannot ask for a negative height, which
  // CSS would drop entirely and leave the menu unbounded again — the bug this file exists for.
  return { up, maxHeightPx: Math.max(0, up ? above : below) };
}
