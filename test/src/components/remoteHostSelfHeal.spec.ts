import { describe, it, expect, vi } from "vitest";
import { registerRemoteHostSelfHeal } from "./remoteHostSelfHeal";

describe("registerRemoteHostSelfHeal", () => {
  it("heals on socket reconnect, window online, and return-to-visible; cleanup stops all", () => {
    const heal = vi.fn();
    const unsubscribe = vi.fn();
    const registered: Array<() => void> = [];
    const onReconnect = (cb: () => void) => {
      registered.push(cb);
      return unsubscribe;
    };

    const stop = registerRemoteHostSelfHeal(heal, onReconnect);
    expect(registered).toHaveLength(1);

    registered[0]?.(); // server came back
    window.dispatchEvent(new Event("online")); // network restored
    document.dispatchEvent(new Event("visibilitychange")); // visible (jsdom default)
    expect(heal).toHaveBeenCalledTimes(3);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1); // socket reconnect listener removed
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heal).toHaveBeenCalledTimes(3); // DOM listeners removed too
  });

  it("does NOT heal when a visibilitychange fires while the tab is going hidden", () => {
    const heal = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

    const stop = registerRemoteHostSelfHeal(heal, () => () => undefined);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heal).not.toHaveBeenCalled();

    stop();
    if (original) Object.defineProperty(document, "visibilityState", original);
  });
});
