// Whether the full-screen overlay a component sits in is on screen. An overlay is created on its first
// open and only hidden after that, so anything under it that polls or reads on mount has to follow
// this instead of its own lifetime.
import { computed, inject, onBeforeUnmount, provide, ref, watch, type ComputedRef, type InjectionKey, type Ref } from "vue";

const OVERLAY_VISIBLE: InjectionKey<Ref<boolean>> = Symbol("overlayVisible");

export function provideOverlayVisible(open: Ref<boolean>): void {
  provide(OVERLAY_VISIBLE, open);
}

/** Visible when there is no overlay above: a component mounted on its own is on screen. */
export function useOverlayVisible(): Ref<boolean> {
  return inject(OVERLAY_VISIBLE, ref(true));
}

/** True from the first time `open` is true: the body is created then, and kept. */
export function useEverOpened(open: Ref<boolean>): ComputedRef<boolean> {
  const opened = ref(open.value);
  watch(open, (isOpen) => {
    if (isOpen) opened.value = true;
  });
  return computed(() => opened.value);
}

/** `source` while the overlay is open, and the last value it had while it is closed: a closed overlay's
 *  route says nothing about it, and the hidden screen must not switch to a different room or build. */
export function heldWhileClosed<T>(open: Ref<boolean>, source: () => T): ComputedRef<T> {
  let last = source();
  return computed(() => {
    if (open.value) last = source();
    return last;
  });
}

/** Runs `start` each time the overlay is shown (and now, if it is) and `stop` each time it is hidden. */
export function whileOverlayVisible(start: () => void, stop: () => void = () => undefined): void {
  const visible = useOverlayVisible();
  watch(visible, (shown) => (shown ? start() : stop()), { immediate: true });
  onBeforeUnmount(stop);
}

/** Runs `read` each time the overlay is shown again — not the first time, which the caller's own
 *  mount-time read covers. */
export function onOverlayShownAgain(read: () => void): void {
  watch(useOverlayVisible(), (shown, wasShown) => {
    if (shown && !wasShown) read();
  });
}
