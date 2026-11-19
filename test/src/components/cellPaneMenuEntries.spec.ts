import { describe, it, expect } from "vitest";
import { hasChoice, historyEntries, toolEntries, type CellPaneMenuState } from "../../../src/components/cellPaneMenuEntries";

const t = (key: string) => key;
const state = (over: Partial<CellPaneMenuState> = {}): CellPaneMenuState => ({
  rightPane: null,
  canvasAvailable: true,
  collectionsAvailable: false,
  timelineAvailable: false,
  libraryAvailable: false,
  restartAvailable: false,
  talkAvailable: false,
  ...over,
});
const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id);

describe("historyEntries", () => {
  it("lists prompts and conversation, plus the timeline when the cell has one", () => {
    expect(ids(historyEntries(state(), t))).toEqual(["prompts", "transcript"]);
    expect(ids(historyEntries(state({ timelineAvailable: true }), t))).toEqual(["prompts", "transcript", "timeline"]);
  });

  // #3027: a pane opens beside the tiles too, so a tile's panes are as pickable as the enlarged
  // cell's, each with its own line.
  it("never disables a pane", () => {
    const entries = historyEntries(state({ timelineAvailable: true }), t);
    expect(entries.map((entry) => [entry.id, entry.disabled])).toEqual([
      ["prompts", false],
      ["transcript", false],
      ["timeline", false],
    ]);
    expect(entries[0].detail).toBe("cellMenu.items.prompts.detail");
  });

  it("checks the pane that is open, and never the timeline", () => {
    const entries = historyEntries(state({ rightPane: "transcript", timelineAvailable: true }), t);
    expect(entries.map((entry) => entry.checked)).toEqual([false, true, undefined]);
  });
});

describe("the library entry", () => {
  it("closes the History menu, set apart, for a session the Library lists", () => {
    const entries = historyEntries(state({ timelineAvailable: true, libraryAvailable: true }), t);
    expect(ids(entries)).toEqual(["prompts", "transcript", "timeline", "library"]);
    expect(entries.at(-1)?.separated).toBe(true);
    expect(entries.at(-1)?.checked).toBeUndefined();
  });

  it("is absent for a session the Library does not list", () => {
    expect(ids(historyEntries(state({ timelineAvailable: true }), t))).not.toContain("library");
  });
});

describe("toolEntries", () => {
  it("lists tools and canvas, and collections only where the directory has the collection tools", () => {
    expect(ids(toolEntries(state(), t))).toEqual(["tools", "canvas"]);
    expect(ids(toolEntries(state({ collectionsAvailable: true }), t))).toEqual(["tools", "canvas", "collections"]);
  });

  // The collections pane has no close of its own, so its entry stays while it is open.
  it("keeps collections while its pane is open, even with the tools gone", () => {
    const entries = toolEntries(state({ rightPane: "collections" }), t);
    expect(ids(entries)).toEqual(["tools", "canvas", "collections"]);
    expect(entries[2].checked).toBe(true);
  });

  it("does not bring collections back for another open pane", () => {
    expect(ids(toolEntries(state({ rightPane: "tools" }), t))).toEqual(["tools", "canvas"]);
  });

  // Disabled rather than missing: the line is where the fix goes.
  it("disables canvas without the render tools, with the fix as its line", () => {
    const canvas = toolEntries(state({ canvasAvailable: false }), t)[1];
    expect(canvas.disabled).toBe(true);
    expect(canvas.detail).toBe("cellMenu.canvasUnavailable");
    expect(toolEntries(state(), t)[1].disabled).toBe(false);
  });
});

describe("the restart entry", () => {
  it("closes the Tools menu, set apart, when the cell has an agent to restart", () => {
    const entries = toolEntries(state({ restartAvailable: true }), t);
    expect(ids(entries)).toEqual(["tools", "canvas", "restart"]);
    expect(entries[2].separated).toBe(true);
    expect(entries[2].checked).toBeUndefined();
  });

  it("is absent without an agent to restart", () => {
    expect(ids(toolEntries(state(), t))).not.toContain("restart");
  });
});

// #2421. Talking to another terminal is an action too: it opens a panel, not a pane.
describe("the talk entry", () => {
  it("sits between the views and restart, and only it opens the divider", () => {
    const entries = toolEntries(state({ talkAvailable: true, restartAvailable: true }), t);
    expect(ids(entries)).toEqual(["tools", "canvas", "talk", "restart"]);
    expect(entries.map((entry) => entry.separated ?? false)).toEqual([false, false, true, false]);
    expect(entries[2].icon).toBe("forum");
    expect(entries[2].checked).toBeUndefined();
  });

  it("opens the divider itself when there is nothing to restart", () => {
    const entries = toolEntries(state({ talkAvailable: true }), t);
    expect(ids(entries)).toEqual(["tools", "canvas", "talk"]);
    expect(entries[2].separated).toBe(true);
  });

  it("is absent with no other terminal", () => {
    expect(ids(toolEntries(state({ restartAvailable: true }), t))).not.toContain("talk");
  });
});

describe("hasChoice", () => {
  it("is false only when every entry is disabled", () => {
    const canvasOnly = toolEntries(state({ canvasAvailable: false }), t).filter((entry) => entry.id === "canvas");
    expect(hasChoice(canvasOnly)).toBe(false);
    expect(hasChoice(historyEntries(state(), t))).toBe(true);
    expect(hasChoice([])).toBe(false);
  });
});
