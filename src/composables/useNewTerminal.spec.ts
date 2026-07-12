import { describe, it, expect, vi, beforeEach } from "vitest";

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
});
