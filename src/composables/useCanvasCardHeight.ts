import { onBeforeUnmount, watch, type Ref } from "vue";

// The Canvas's fixed-height plugin cards used to be sized in `vh` — a fraction of the
// VIEWPORT, which is not the box they live in. The panel sits below the app toolbar and
// the Canvas header, carries its own padding, and can be narrower/shorter than the window
// (a grid cell, a split pane), so `80vh` was always a guess that overshot by the height of
// whatever chrome happened to be above it.
//
// Instead, measure the scroll container the cards are laid out in and publish its usable
// height as a CSS custom property. Cards ask for `var(--canvas-card-h)` (see
// plugins-registry's CANVAS_CARD_HEIGHT), so ONE write here resizes every card — no
// per-card style updates — and custom properties inherit through the plugin Shadow DOM,
// so a view's internal `h-full` chain resolves against the same number.
//
// Observe the SCROLL CONTAINER, never the content. Its height comes from the flex parent,
// not from what is inside it, so writing the variable cannot change the observed box —
// which is what keeps this out of a "ResizeObserver loop completed with undelivered
// notifications" cycle.
//
// A hidden pane (measuring 0) is the one measurement not published; see canvasCardHeightPx.
export const CANVAS_CARD_HEIGHT_VAR = "--canvas-card-h";

/**
 * The height to publish for a panel of `clientHeight` with `paddingYPx` of vertical padding,
 * or null when the measurement is not usable.
 *
 * `clientHeight` INCLUDES padding, and the cards are laid out inside it, so the padding is
 * subtracted — otherwise a card sized to the full clientHeight always overflows by exactly
 * the padding and every card shows a scrollbar it does not need.
 *
 * Only a NON-POSITIVE result is refused, and that is the whole test for "not being looked
 * at": a closed pane, or a grid cell parked off-screen in roster mode, measures 0, and
 * publishing that would collapse every card to nothing until something else resized the box.
 * ResizeObserver publishes the real size the moment such a pane becomes visible.
 *
 * A floor above zero was tried and is wrong (caught in review on #1266): a genuinely short
 * panel — a low window, a small grid cell — produces a small-but-legitimate measurement, and
 * refusing it leaves the cards on the `80vh` fallback or on a stale larger value, i.e. the
 * exact overflow this whole change removes. Small is still contained; unpublished is not.
 */
export function canvasCardHeightPx(clientHeight: number, paddingYPx: number): number | null {
  if (!Number.isFinite(clientHeight) || !Number.isFinite(paddingYPx)) return null;
  const usable = Math.round(clientHeight - paddingYPx);
  return usable > 0 ? usable : null;
}

function paddingYOf(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const total = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  return Number.isFinite(total) ? total : 0;
}

/**
 * Keep CANVAS_CARD_HEIGHT_VAR on `target` in step with its own measured height.
 *
 * `onResized` runs after each write that changed the value — GuiPanel uses it to re-pin a
 * reader who was parked at the bottom, since resizing every card changes scrollHeight while
 * the browser holds scrollTop in pixels.
 */
export function useCanvasCardHeight(target: Ref<HTMLElement | null>, onResized?: () => void): void {
  let observer: ResizeObserver | null = null;
  let published: number | null = null;

  function measure(element: HTMLElement): void {
    const height = canvasCardHeightPx(element.clientHeight, paddingYOf(element));
    if (height === null || height === published) return;
    published = height;
    element.style.setProperty(CANVAS_CARD_HEIGHT_VAR, `${height}px`);
    onResized?.();
  }

  function stop(): void {
    observer?.disconnect();
    observer = null;
  }

  // The ref is filled after mount and re-filled whenever the pane is re-created, so watch it
  // rather than reading it once in onMounted.
  watch(
    target,
    (element) => {
      stop();
      published = null;
      if (!element) return;
      // jsdom and older embedders have no ResizeObserver; the first measurement below still
      // gives cards a real height, it just stops tracking later resizes.
      if (typeof ResizeObserver === "undefined") {
        measure(element);
        return;
      }
      observer = new ResizeObserver(() => measure(element));
      observer.observe(element);
      // ResizeObserver fires an initial callback on observe(), but measuring here too means
      // the first paint of a card never happens against an unset variable.
      measure(element);
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);
}
