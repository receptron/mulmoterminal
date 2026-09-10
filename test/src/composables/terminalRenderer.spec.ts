// The disposal order xterm 6 + the xterm-5-era canvas addon require, and the promise that neither
// side can stop the caller (#2021).
import { describe, it, expect, vi, afterEach } from "vitest";
import { disposeTerminal, type Disposes } from "../../../src/composables/terminalRenderer";

const recorder = () => {
  const order: string[] = [];
  const make = (name: string, throws = false): Disposes => ({
    dispose: () => {
      order.push(name);
      if (throws) throw new Error(`${name} refused`);
    },
  });
  return { order, make };
};

describe("disposeTerminal", () => {
  afterEach(() => vi.restoreAllMocks());

  // The whole point. On dispose the addon asks the core for a DOM renderer, and the core builds it
  // out of a linkifier the terminal's own dispose has already cleared — so the addon has to go
  // while the terminal is still whole.
  it("disposes the renderer before the terminal", () => {
    const { order, make } = recorder();
    disposeTerminal(make("term"), make("renderer"));
    expect(order).toEqual(["renderer", "term"]);
  });

  it("disposes the terminal even when the renderer throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { order, make } = recorder();
    expect(() => disposeTerminal(make("term"), make("renderer", true))).not.toThrow();
    expect(order).toEqual(["renderer", "term"]);
  });

  // The caller has work left after this — the rebuild path reconnects the replacement terminal —
  // so a throw here is what turns "the cell blinked" into "the cell is dead".
  it("does not throw at the caller when the terminal throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { order, make } = recorder();
    expect(() => disposeTerminal(make("term", true), make("renderer"))).not.toThrow();
    expect(order).toEqual(["renderer", "term"]);
  });

  it("says which side refused, rather than swallowing it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { make } = recorder();
    disposeTerminal(make("term"), make("renderer", true));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("canvas renderer");
  });

  // The canvas addon is best-effort: where it cannot initialise, xterm keeps its own DOM renderer
  // and there is nothing of ours to dispose first.
  it("disposes the terminal alone when there is no renderer addon", () => {
    const { order, make } = recorder();
    disposeTerminal(make("term"), null);
    expect(order).toEqual(["term"]);
  });

  it("disposes each side exactly once", () => {
    const term = { dispose: vi.fn() };
    const renderer = { dispose: vi.fn() };
    disposeTerminal(term, renderer);
    expect(term.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });
});
