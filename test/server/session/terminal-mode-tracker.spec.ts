// @vitest-environment node
import { describe, it, expect } from "vitest";
import { TerminalModeTracker } from "../../../server/session/terminal-mode-tracker.js";

const ESC = "\x1b";

describe("TerminalModeTracker", () => {
  it("tracks a single DECSET mode", () => {
    const t = new TerminalModeTracker();
    t.scan(`${ESC}[?1049h`);
    expect(t.modes()).toEqual([1049]);
  });

  it("tracks multiple modes in one sequence", () => {
    const t = new TerminalModeTracker();
    t.scan(`${ESC}[?1049;1000;1006h`);
    const modes = [...t.modes()].sort();
    expect(modes).toEqual([1000, 1006, 1049]);
  });

  it("removes modes on DECRST", () => {
    const t = new TerminalModeTracker();
    t.scan(`${ESC}[?1049h${ESC}[?1000h`);
    expect(t.modes()).toContain(1049);
    expect(t.modes()).toContain(1000);
    t.scan(`${ESC}[?1049l`);
    expect(t.modes()).not.toContain(1049);
    expect(t.modes()).toContain(1000);
  });

  it("ignores untracked modes", () => {
    const t = new TerminalModeTracker();
    t.scan(`${ESC}[?25h`); // cursor visibility — not tracked
    expect(t.modes()).toEqual([]);
  });

  it("handles modes embedded in other output", () => {
    const t = new TerminalModeTracker();
    t.scan(`hello${ESC}[?1049hworld${ESC}[?1006h`);
    const modes = [...t.modes()].sort();
    expect(modes).toEqual([1006, 1049]);
  });

  it("handles a sequence split across two chunks — ESC at end", () => {
    const t = new TerminalModeTracker();
    t.scan(`output${ESC}`);
    t.scan(`[?1049h`);
    expect(t.modes()).toEqual([1049]);
  });

  it("handles a sequence split across two chunks — ESC[ at end", () => {
    const t = new TerminalModeTracker();
    t.scan(`output${ESC}[`);
    t.scan(`?1049h`);
    expect(t.modes()).toEqual([1049]);
  });

  it("handles a sequence split across two chunks — params split", () => {
    const t = new TerminalModeTracker();
    t.scan(`${ESC}[?10`);
    t.scan(`49h`);
    expect(t.modes()).toEqual([1049]);
  });

  it("handles a sequence split after semicolon", () => {
    const t = new TerminalModeTracker();
    t.scan(`${ESC}[?1049;`);
    t.scan(`1006h`);
    const modes = [...t.modes()].sort();
    expect(modes).toEqual([1006, 1049]);
  });

  it("returns empty for a fresh tracker", () => {
    const t = new TerminalModeTracker();
    expect(t.modes()).toEqual([]);
  });

  it("survives non-DECSET CSI sequences without tracking them", () => {
    const t = new TerminalModeTracker();
    t.scan(`${ESC}[31m${ESC}[?1049h${ESC}[0m`);
    expect(t.modes()).toEqual([1049]);
  });
});
