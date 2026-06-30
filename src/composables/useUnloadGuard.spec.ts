import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useUnloadGuard, reportActiveTerminals } from "./useUnloadGuard";

// Mount a bare host so the composable's onMounted/onUnmounted run (and the
// beforeunload listener is registered/removed) on a real lifecycle.
const Host = defineComponent({
  setup() {
    useUnloadGuard();
    return () => null;
  },
});

const fireBeforeUnload = (): boolean => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

describe("useUnloadGuard", () => {
  let wrapper: ReturnType<typeof mount> | null = null;
  beforeEach(() => {
    reportActiveTerminals("single", 0);
    reportActiveTerminals("grid", 0);
  });
  // Unmount between tests so no host's listener lingers and skews the next case.
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("does not block the unload when no terminal is live", () => {
    wrapper = mount(Host);
    expect(fireBeforeUnload()).toBe(false);
  });

  it("blocks the unload while a terminal is live", () => {
    wrapper = mount(Host);
    reportActiveTerminals("grid", 2);
    expect(fireBeforeUnload()).toBe(true);
  });

  it("stops blocking again once the count drops to zero", () => {
    wrapper = mount(Host);
    reportActiveTerminals("grid", 1);
    expect(fireBeforeUnload()).toBe(true);
    reportActiveTerminals("grid", 0);
    expect(fireBeforeUnload()).toBe(false);
  });

  // The persistent-connection case: a single session stays live (its socket is kept
  // open) after switching to the grid, where the grid reports 0 running cells. The
  // hidden single terminal must still count, so the two sources are summed.
  it("still blocks when only the hidden single terminal is live", () => {
    wrapper = mount(Host);
    reportActiveTerminals("single", 1);
    reportActiveTerminals("grid", 0);
    expect(fireBeforeUnload()).toBe(true);
  });

  it("blocks while either source is live and clears only when both are zero", () => {
    wrapper = mount(Host);
    reportActiveTerminals("single", 1);
    reportActiveTerminals("grid", 2);
    expect(fireBeforeUnload()).toBe(true);
    reportActiveTerminals("grid", 0);
    expect(fireBeforeUnload()).toBe(true); // single still live
    reportActiveTerminals("single", 0);
    expect(fireBeforeUnload()).toBe(false);
  });

  it("removes the listener on unmount (no lingering guard)", () => {
    wrapper = mount(Host);
    reportActiveTerminals("grid", 3);
    wrapper.unmount();
    wrapper = null;
    expect(fireBeforeUnload()).toBe(false);
  });
});
