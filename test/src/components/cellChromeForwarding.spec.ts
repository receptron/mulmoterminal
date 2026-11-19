import { describe, it, expect, vi } from "vitest";
import CellChromeButtons from "../../../src/components/CellChromeButtons.vue";
import { cellChromeBinding, cellShellEvents, type CellChromeEvent } from "../../../src/components/cellChromeBinding";

// A cell binds the chrome buttons with ONE object (`v-on="chromeEvents"`), so an event the
// buttons can raise but that object has no key for is dropped where nothing can see it: the
// button clicks, the grid's handler waits for something that never arrives, and typecheck is
// happy because an unlistened emit is legal Vue.
//
// That is not hypothetical. The collections button shipped in #1573 emitting `toggle-collections`
// while `cellChromeBinding` mapped four events and `GridCellEmits` declared five — so "Show this
// folder's collections" never once opened the pane, through a green suite that included a
// "forwards every chrome event" test whose list was TYPED BY HAND from the same wrong set.
//
// Hence: the expectation is DERIVED from the component's own declared emits. A new button is
// covered the day it is added, and a hand-maintained list cannot agree with itself into a
// second silent dead button.
const declaredEmits = (CellChromeButtons as unknown as { emits?: string[] }).emits ?? [];

// Events a CELL binds itself rather than through the shared object, with the reason. These exist
// only on a session terminal (the command and launcher cells never offer them), so TerminalCell
// wires them explicitly beside `v-on="chromeEvents"`; terminalCellTalkMenu.spec drives the talk pair.
const SELF_BOUND = new Set(["toggle-park", "open-timeline", "open-library", "restart-agent", "open-talk", "tools-opening"]);

const forwarded = (keys: string[]): Set<string> => new Set([...keys, ...SELF_BOUND]);

describe("cellChromeBinding forwards every event the chrome buttons can raise", () => {
  it("declares emits at runtime, so this spec is comparing against something real", () => {
    // Guards the derivation itself: if the SFC compiler stopped emitting the array, every
    // assertion below would pass vacuously against an empty list.
    expect(declaredEmits).toContain("toggle-collections");
    expect(declaredEmits.length).toBeGreaterThan(5);
  });

  it("maps each one in chromeEvents — the binding TerminalCell and CellShell use", () => {
    const { chromeEvents } = cellChromeBinding({ expanded: true }, () => {});
    expect(forwarded(Object.keys(chromeEvents))).toEqual(new Set(declaredEmits));
  });

  it("maps each one in cellShellEvents — the binding the command and launcher cells use", () => {
    const events = cellShellEvents(() => {});
    // `move` and `open-files` are the shell's own (its reorder buttons and its path menu), not a
    // chrome button's, so they are the extra keys here.
    const SHELL_OWN = new Set(["move", "open-files"]);
    expect(forwarded(Object.keys(events).filter((key) => !SHELL_OWN.has(key)))).toEqual(new Set(declaredEmits));
  });

  it("re-emits each event under its OWN name rather than a near-miss", () => {
    const emit = vi.fn();
    const { chromeEvents } = cellChromeBinding({ expanded: true }, emit);
    for (const [name, handler] of Object.entries(chromeEvents)) {
      emit.mockClear();
      handler();
      expect(emit).toHaveBeenCalledWith(name as CellChromeEvent);
    }
  });

  it("still routes close through the caller's own handler", () => {
    const emit = vi.fn();
    const close = vi.fn();
    cellChromeBinding({ expanded: true }, emit, close).chromeEvents.close();
    expect(close).toHaveBeenCalledTimes(1);
    // TerminalCell's close confirms before tearing a live session down — it must not ALSO emit.
    expect(emit).not.toHaveBeenCalled();
  });
});
