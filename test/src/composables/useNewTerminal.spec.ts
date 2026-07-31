import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, KeepAlive, ref, nextTick, onActivated, onDeactivated } from "vue";
import { mount } from "@vue/test-utils";

// `currentRoute` as well as `push`: opening now asks where the user IS before navigating, because
// a mounted grid is not necessarily a visible one — it survives under a full-screen overlay.
const { push, routeName } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()), routeName: { value: "terminals" as string } }));
vi.mock("../../../src/router/index", () => ({
  router: {
    push,
    currentRoute: {
      get value() {
        return { name: routeName.value };
      },
    },
  },
}));

import { registerNewTerminalHandler, openTerminalAt } from "../../../src/composables/useNewTerminal";

describe("useNewTerminal", () => {
  beforeEach(() => {
    registerNewTerminalHandler(() => {})(); // drain any leftover pending + clear the handler
    push.mockClear();
    routeName.value = "terminals"; // the usual case: the user is looking at the grid
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
    routeName.value = "chat"; // no grid mounted means the user is not looking at one
    openTerminalAt("/proj", "single");
    expect(push).toHaveBeenCalledWith("/terminals");
    const h = vi.fn();
    const off = registerNewTerminalHandler(h); // GridView mounts and registers
    expect(h).toHaveBeenCalledWith({ cwd: "/proj", afterSlotKey: "single" });
    off();
  });

  // The grid stays mounted underneath a full-screen overlay (#1193), so it can take the request
  // while the user is still looking at the wiki or the collection browser. Handing it over is not
  // enough — the phone's launch would be reported as served and the terminal would appear behind
  // the overlay, seen by nobody.
  it("switches to the grid even when a mounted one took the request", () => {
    routeName.value = "wiki";
    const h = vi.fn();
    const off = registerNewTerminalHandler(h);

    openTerminalAt("/proj", null);

    expect(h).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/terminals");
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
    routeName.value = "chat"; // ...and the user is somewhere else, which is why it deactivated
    await nextTick();
    openTerminalAt("/b", "single"); // no live handler → queue + navigate
    expect(push).toHaveBeenCalledWith("/terminals");

    active.value = true; // reactivate → re-register drains the queued request
    await nextTick();
    expect(handler).toHaveBeenCalledWith({ cwd: "/b", afterSlotKey: "single" });
    wrapper.unmount();
  });

  // The phone drives this over pub/sub (#831) and the host answers each command with success,
  // so a request dropped here is a launch reported as done that never happened. One slot was
  // enough only while a person pressing a button was the sole caller.
  it("drains EVERY request queued while the grid was away, in arrival order", () => {
    openTerminalAt("/first", null, "shell");
    openTerminalAt("/second", null, "claude");
    openTerminalAt("/third", null, "codex");
    const h = vi.fn();
    const off = registerNewTerminalHandler(h);
    expect(h).toHaveBeenCalledTimes(3);
    expect(h.mock.calls.map(([req]) => [req.cwd, req.agent])).toEqual([
      ["/first", "shell"],
      ["/second", "claude"],
      ["/third", "codex"],
    ]);
    off();
  });

  it("carries the agent through to a live handler, and leaves it unset for the shell button", () => {
    const h = vi.fn();
    const off = registerNewTerminalHandler(h);
    openTerminalAt("/proj", null, "codex");
    expect(h).toHaveBeenCalledWith({ cwd: "/proj", afterSlotKey: null, agent: "codex" });
    openTerminalAt("/proj", null);
    expect(h).toHaveBeenLastCalledWith({ cwd: "/proj", afterSlotKey: null, agent: undefined });
    off();
  });

  it("empties the queue once drained, so a later register replays nothing", () => {
    openTerminalAt("/once", null);
    registerNewTerminalHandler(vi.fn())();
    const second = vi.fn();
    const off = registerNewTerminalHandler(second);
    expect(second).not.toHaveBeenCalled();
    off();
  });
});
