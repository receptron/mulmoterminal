import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, KeepAlive, ref, nextTick, onActivated, onDeactivated } from "vue";
import { mount } from "@vue/test-utils";

const { push } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()) }));
vi.mock("../router", () => ({ router: { push } }));

import { registerNewTerminalHandler, openTerminalAt } from "./useNewTerminal";

describe("useNewTerminal", () => {
  beforeEach(() => {
    registerNewTerminalHandler(() => {})(); // drain any leftover pending + clear the handler
    push.mockClear();
  });

  it("calls the registered handler directly when the grid is mounted", () => {
    const h = vi.fn();
    const off = registerNewTerminalHandler(h);
    openTerminalAt("/proj", "cell-3");
    expect(h).toHaveBeenCalledWith({ cwd: "/proj", afterSlotKey: "cell-3" });
    expect(push).not.toHaveBeenCalled();
    off();
  });

  it("queues + navigates to /terminals with no grid, then drains on register (single-view path)", () => {
    openTerminalAt("/proj", "single");
    expect(push).toHaveBeenCalledWith("/terminals");
    const h = vi.fn();
    const off = registerNewTerminalHandler(h); // GridView mounts and registers
    expect(h).toHaveBeenCalledWith({ cwd: "/proj", afterSlotKey: "single" });
    off();
  });

  it("a stale unregister does not clear a newer handler", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const off1 = registerNewTerminalHandler(h1);
    const off2 = registerNewTerminalHandler(h2); // h2 is current now
    off1(); // stale — must NOT detach h2
    openTerminalAt("/x", null);
    expect(h2).toHaveBeenCalled();
    expect(h1).not.toHaveBeenCalled();
    off2();
  });

  // Regression for the KeepAlive case (GridView is cached): while DEACTIVATED the opener must be
  // unregistered so a single-view button press navigates to the grid instead of mutating hidden state.
  it("register-on-activate / unregister-on-deactivate: deactivated → queue + navigate, reactivated → drain", async () => {
    const handler = vi.fn();
    const active = ref(true);
    const Probe = defineComponent({
      setup() {
        let off: (() => void) | null = null;
        onActivated(() => (off = registerNewTerminalHandler(handler)));
        onDeactivated(() => {
          off?.();
          off = null;
        });
        return () => h("div");
      },
    });
    const Host = defineComponent({ setup: () => () => h(KeepAlive, () => (active.value ? h(Probe) : null)) });
    const wrapper = mount(Host);
    await nextTick();

    openTerminalAt("/a", "cell-1"); // active → handler runs, no navigation
    expect(handler).toHaveBeenCalledWith({ cwd: "/a", afterSlotKey: "cell-1" });
    expect(push).not.toHaveBeenCalled();

    active.value = false; // KeepAlive deactivates the probe (not unmounted)
    await nextTick();
    openTerminalAt("/b", "single"); // no live handler → queue + navigate
    expect(push).toHaveBeenCalledWith("/terminals");

    active.value = true; // reactivate → re-register drains the queued request
    await nextTick();
    expect(handler).toHaveBeenCalledWith({ cwd: "/b", afterSlotKey: "single" });
    wrapper.unmount();
  });
});
