import { describe, it, expect, vi } from "vitest";

import { installFileDropGuard } from "../../../src/composables/useFileDropGuard";

// A minimal window double: records listeners so a test can fire them, and drops them
// on removeEventListener so teardown is observable.
function fakeTarget() {
  const listeners = new Map<string, EventListener>();
  return {
    addEventListener: (type: string, fn: EventListener) => listeners.set(type, fn),
    removeEventListener: (type: string, fn: EventListener) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    fire: (type: string, dataTransfer: { types: string[] } | null) => {
      const preventDefault = vi.fn();
      listeners.get(type)?.({ dataTransfer, preventDefault } as unknown as Event);
      return preventDefault;
    },
    has: (type: string) => listeners.has(type),
  };
}

describe("installFileDropGuard", () => {
  it("prevents the default on a file dragover and drop, so nothing navigates", () => {
    const target = fakeTarget();
    installFileDropGuard(target);
    expect(target.fire("dragover", { types: ["Files"] })).toHaveBeenCalled();
    expect(target.fire("drop", { types: ["text/uri-list", "Files"] })).toHaveBeenCalled();
  });

  it("leaves an in-app / text drag alone", () => {
    const target = fakeTarget();
    installFileDropGuard(target);
    expect(target.fire("dragover", { types: ["text/plain"] })).not.toHaveBeenCalled();
    expect(target.fire("drop", { types: ["application/x-cell-reorder"] })).not.toHaveBeenCalled();
  });

  it("does nothing when the event carries no dataTransfer", () => {
    const target = fakeTarget();
    installFileDropGuard(target);
    expect(target.fire("drop", null)).not.toHaveBeenCalled();
  });

  it("removes both listeners on teardown", () => {
    const target = fakeTarget();
    const uninstall = installFileDropGuard(target);
    uninstall();
    expect(target.has("dragover")).toBe(false);
    expect(target.has("drop")).toBe(false);
  });

  // The unit tests above assert preventDefault is CALLED; this drives the real window so the
  // browser-observable effect — a cancelled event, i.e. no navigation — is what's verified.
  it("cancels a real file drop dispatched on window (so the browser won't navigate)", () => {
    const uninstall = installFileDropGuard(window);
    const drop = new Event("drop", { cancelable: true, bubbles: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"] } });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);

    const textDrop = new Event("drop", { cancelable: true, bubbles: true });
    Object.defineProperty(textDrop, "dataTransfer", { value: { types: ["text/plain"] } });
    window.dispatchEvent(textDrop);
    expect(textDrop.defaultPrevented).toBe(false);
    uninstall();
  });
});
