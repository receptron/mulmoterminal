import { describe, it, expect, vi } from "vitest";

import { installPageZoomGuard } from "../../../src/composables/usePageZoomGuard";

// A minimal window double: records listeners (with the options they were registered under, so
// the passive:false contract is testable) and drops them on removeEventListener.
function fakeTarget() {
  const listeners = new Map<string, { fn: EventListener; options?: AddEventListenerOptions | undefined }>();
  return {
    addEventListener: (type: string, fn: EventListener, options?: AddEventListenerOptions) => listeners.set(type, { fn, options }),
    removeEventListener: (type: string, fn: EventListener) => {
      if (listeners.get(type)?.fn === fn) listeners.delete(type);
    },
    fire: (type: string, init: { ctrlKey?: boolean } = {}) => {
      const preventDefault = vi.fn();
      listeners.get(type)?.fn({ ...init, preventDefault } as unknown as Event);
      return preventDefault;
    },
    optionsOf: (type: string) => listeners.get(type)?.options,
    has: (type: string) => listeners.has(type),
  };
}

const GESTURES = ["gesturestart", "gesturechange", "gestureend"];

describe("installPageZoomGuard", () => {
  it("prevents the default on a ctrl+wheel, so the browser won't page-zoom", () => {
    const target = fakeTarget();
    installPageZoomGuard(target);
    expect(target.fire("wheel", { ctrlKey: true })).toHaveBeenCalled();
  });

  it("leaves a plain wheel alone, so scrolling still reaches the terminal", () => {
    const target = fakeTarget();
    installPageZoomGuard(target);
    expect(target.fire("wheel", { ctrlKey: false })).not.toHaveBeenCalled();
  });

  it("prevents the default on every WebKit pinch gesture event", () => {
    const target = fakeTarget();
    installPageZoomGuard(target);
    GESTURES.forEach((type) => expect(target.fire(type), type).toHaveBeenCalled());
  });

  // Without passive:false Chrome ignores the preventDefault silently, so the guard would look
  // installed and do nothing.
  it("registers the wheel listener as non-passive", () => {
    const target = fakeTarget();
    installPageZoomGuard(target);
    expect(target.optionsOf("wheel")?.passive).toBe(false);
  });

  it("removes every listener on teardown", () => {
    const target = fakeTarget();
    const uninstall = installPageZoomGuard(target);
    uninstall();
    expect(target.has("wheel")).toBe(false);
    GESTURES.forEach((type) => expect(target.has(type), type).toBe(false));
  });

  // The unit tests above assert preventDefault is CALLED; this drives the real window so the
  // browser-observable effect — a cancelled event, i.e. no zoom — is what's verified.
  it("cancels a real ctrl+wheel dispatched on window, and only that", () => {
    const uninstall = installPageZoomGuard(window);
    const zoom = new WheelEvent("wheel", { ctrlKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);

    const scroll = new WheelEvent("wheel", { deltaY: 120, cancelable: true, bubbles: true });
    window.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);

    const pinch = new Event("gesturechange", { cancelable: true, bubbles: true });
    window.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    uninstall();
  });
});
