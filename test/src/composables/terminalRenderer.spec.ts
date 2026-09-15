// The disposal order xterm 6 + the xterm-5-era canvas addon require, and the promise that neither
// side can stop the caller (#2021).
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  attachRenderer,
  disposeTerminal,
  trackTextureAtlas,
  untrackTextureAtlas,
  type Disposes,
  type ClearsTextureAtlas,
} from "../../../src/composables/terminalRenderer";

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

describe("attachRenderer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands back the renderer it loaded", () => {
    const renderer = { dispose: vi.fn() };
    const term = { loadAddon: vi.fn() };
    expect(attachRenderer(term, renderer)).toBe(renderer);
    expect(term.loadAddon).toHaveBeenCalledWith(renderer);
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  // xterm registers an addon BEFORE it activates it, so a throw out of activate() leaves it in the
  // addon list — where the terminal's own dispose would reach it at the moment this module exists
  // to avoid (CodeRabbit, PR #2026).
  it("disposes a renderer whose activation threw, while the terminal is still whole", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = { dispose: vi.fn() };
    const term = {
      loadAddon: () => {
        throw new Error("no 2d context");
      },
    };
    expect(attachRenderer(term, renderer)).toBeNull();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("survives a half-loaded renderer that will not let go either", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer: Disposes = {
      dispose: () => {
        throw new Error("half-built");
      },
    };
    const term = {
      loadAddon: () => {
        throw new Error("no 2d context");
      },
    };
    expect(() => attachRenderer(term, renderer)).not.toThrow();
    expect(attachRenderer(term, renderer)).toBeNull();
  });
});

// The GPU comes back and the glyphs do not (#2076). Chrome blanks every 2D canvas when it restarts
// its GPU process; the addon's glyph cache still says each glyph is rasterized, so it blits from
// empty atlas pages and the text stays invisible until the page is reloaded.
describe("rebuilding the glyph atlas when the GPU comes back", () => {
  const tracked: object[] = [];

  const owner = (throws = false) => {
    const term: ClearsTextureAtlas & { cleared: number } = {
      cleared: 0,
      clearTextureAtlas() {
        term.cleared += 1;
        if (throws) throw new Error("renderer refused");
      },
    };
    trackTextureAtlas(term);
    tracked.push(term);
    return term;
  };

  /** A restore as the browser dispatches it: on the canvas, not bubbling — so only a CAPTURE
   *  listener on an ancestor ever sees it. */
  const restore = (target: EventTarget = document.createElement("canvas")) => {
    if (target instanceof HTMLElement) document.body.appendChild(target);
    target.dispatchEvent(new Event("contextrestored", { bubbles: false }));
  };

  afterEach(() => {
    tracked.splice(0).forEach(untrackTextureAtlas);
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("rebuilds every tracked terminal's atlas", async () => {
    const a = owner();
    const b = owner();
    restore();
    await Promise.resolve();
    expect([a.cleared, b.cleared]).toEqual([1, 1]);
  });

  // Every terminal, not the one whose canvas fired: a cell with a different font size has its own
  // atlas, and one parked off-screen fires nothing while still holding a stale cache.
  it("rebuilds a terminal whose own canvas fired nothing", async () => {
    const offscreen = owner();
    restore(document.createElement("canvas"));
    await Promise.resolve();
    expect(offscreen.cleared).toBe(1);
  });

  // One GPU restart fires the event once per canvas, and each rebuild is a full refresh of every
  // cell. Coalesced into one pass.
  it("rebuilds once for a burst of events", async () => {
    const term = owner();
    restore();
    restore();
    restore();
    await Promise.resolve();
    expect(term.cleared).toBe(1);
  });

  it("does nothing until a restore actually arrives", async () => {
    const term = owner();
    await Promise.resolve();
    expect(term.cleared).toBe(0);
  });

  // A terminal that has been disposed must not be reached: its renderer is gone and the call would
  // land on a torn-down object.
  it("leaves a disposed terminal alone", async () => {
    const gone = owner();
    const live = owner();
    disposeTerminal(gone as unknown as Disposes, null);
    restore();
    await Promise.resolve();
    expect([gone.cleared, live.cleared]).toEqual([0, 1]);
  });

  // A recovery path: one cell's renderer refusing must not cost the others theirs.
  it("keeps going when one terminal throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = owner(true);
    const good = owner();
    restore();
    await Promise.resolve();
    expect([bad.cleared, good.cleared]).toEqual([1, 1]);
  });
});
