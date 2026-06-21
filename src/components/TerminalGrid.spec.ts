import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalGrid from "./TerminalGrid.vue";
import type { Layout } from "./gridLayout";

// Stub the cell so the grid's own state (localStorage persist/restore + zoom +
// layout) can be tested without pulling in Terminal/xterm/pub-sub.
vi.mock("./TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "initialSessionId", "initialCwd", "defaultCwd", "presets", "home"],
    emits: ["toggle-expand", "session", "cwd", "close"],
    template: '<div class="stub-cell" />',
  },
}));

const STORE_KEY = "grid_state_v1";
const mountGrid = (layout: Layout = "2x2") => mount(TerminalGrid, { props: { layout, defaultCwd: "/work/proj", presets: [], home: "/work" } });
const cellsOf = (w: ReturnType<typeof mount>) => w.findAllComponents({ name: "TerminalCell" });
const saved = () => JSON.parse(localStorage.getItem(STORE_KEY) || "{}");

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cwd: "/work/proj" }) })) as unknown as typeof fetch;
});

describe("TerminalGrid", () => {
  it("renders cellCount cells per layout", () => {
    expect(cellsOf(mountGrid("2x2"))).toHaveLength(4);
    expect(cellsOf(mountGrid("3x2"))).toHaveLength(6);
    expect(cellsOf(mountGrid("4x2"))).toHaveLength(8);
    expect(cellsOf(mountGrid("3x3"))).toHaveLength(9);
  });

  it("re-renders the cell count when the layout prop changes", async () => {
    const w = mountGrid("2x2");
    expect(cellsOf(w)).toHaveLength(4);
    await w.setProps({ layout: "3x3" });
    expect(cellsOf(w)).toHaveLength(9);
  });

  it("un-zooms when the layout shrinks below the expanded cell", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [], expanded: 8 }));
    const w = mountGrid("3x3");
    await flushPromises();
    expect(cellsOf(w)[8].props("expanded")).toBe(true);
    await w.setProps({ layout: "2x2" });
    expect(cellsOf(w).every((c) => c.props("expanded") === false)).toBe(true);
    expect(saved().expanded).toBe(null);
  });

  it("restores each cell's session id and the zoom from localStorage", async () => {
    const idA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const idC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [idA, null, idC, null], expanded: 2 }));
    const w = mountGrid("2x2");
    await flushPromises();
    const cells = cellsOf(w);
    expect(cells[0].props("initialSessionId")).toBe(idA);
    expect(cells[2].props("initialSessionId")).toBe(idC);
    expect(cells[2].props("expanded")).toBe(true);
  });

  it("forwards defaultCwd to cells", async () => {
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)[0].props("defaultCwd")).toBe("/work/proj");
  });

  it("persists a cell's chosen cwd and restores it as initialCwd", async () => {
    const w = mountGrid();
    await flushPromises();
    cellsOf(w)[2].vm.$emit("cwd", "/work/proj/sub");
    await nextTick();
    expect(saved().cwds[2]).toBe("/work/proj/sub");

    const w2 = mountGrid();
    await flushPromises();
    expect(cellsOf(w2)[2].props("initialCwd")).toBe("/work/proj/sub");
  });

  it("persists a cell's session id when it emits 'session'", async () => {
    const w = mountGrid();
    await flushPromises();
    cellsOf(w)[1].vm.$emit("session", "new-id");
    await nextTick();
    expect(saved().sessions[1]).toBe("new-id");
  });

  it("clears the slot (and un-zooms) when a cell emits 'close'", async () => {
    const idA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [idA, null, null, null], expanded: 0 }));
    const w = mountGrid("2x2");
    await flushPromises();
    cellsOf(w)[0].vm.$emit("close");
    await nextTick();
    expect(saved().sessions[0]).toBe(null);
    expect(saved().expanded).toBe(null);
  });

  it("toggles zoom on 'toggle-expand' and back off when emitted again", async () => {
    const w = mountGrid();
    await flushPromises();
    cellsOf(w)[3].vm.$emit("toggle-expand");
    await nextTick();
    expect(cellsOf(w)[3].props("expanded")).toBe(true);
    expect(saved().expanded).toBe(3);
    cellsOf(w)[3].vm.$emit("toggle-expand");
    await nextTick();
    expect(saved().expanded).toBe(null);
  });

  it("drops non-UUID persisted session ids", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: ["not-a-uuid", "../etc/passwd", "id-a", null], expanded: null }));
    const w = mountGrid("2x2");
    await flushPromises();
    expect(cellsOf(w).every((c) => c.props("initialSessionId") === null)).toBe(true);
  });

  it("keeps a valid UUID persisted id", async () => {
    const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [uuid, null, null, null], expanded: null }));
    const w = mountGrid("2x2");
    await flushPromises();
    expect(cellsOf(w)[0].props("initialSessionId")).toBe(uuid);
  });

  it("ignores a corrupt localStorage payload", async () => {
    localStorage.setItem(STORE_KEY, "not json{");
    const w = mountGrid("2x2");
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(4);
    expect(cellsOf(w).every((c) => c.props("initialSessionId") === null)).toBe(true);
  });

  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const D = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

  it("close fills the gap and keeps each session paired with its cwd (compaction)", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, B, C, D], cwds: ["/a", "/b", "/c", "/d"], expanded: null }));
    const w = mountGrid("2x2");
    await flushPromises();
    cellsOf(w)[1].vm.$emit("close"); // close B (position 1)
    await nextTick();

    // B's slot is emptied and the rest pack forward, cwds following their session.
    expect(saved().sessions.slice(0, 4)).toEqual([A, C, D, null]);
    expect(saved().cwds.slice(0, 4)).toEqual(["/a", "/c", "/d", null]);
    const cells = cellsOf(w);
    expect(cells[1].props("initialSessionId")).toBe(C);
    expect(cells[1].props("initialCwd")).toBe("/c");
  });

  it("packs running terminals to the top-left on layout shrink, preserving session/cwd pairing", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, null, C, null, E], cwds: ["/a", null, "/c", null, "/e"], expanded: null }));
    const w = mountGrid("3x3");
    await flushPromises();
    await w.setProps({ layout: "2x2" });
    await nextTick();

    expect(saved().sessions.slice(0, 3)).toEqual([A, C, E]);
    expect(saved().cwds.slice(0, 3)).toEqual(["/a", "/c", "/e"]);
    const cells = cellsOf(w); // 2x2 → 4 visible
    expect(cells.map((c) => c.props("initialSessionId")).slice(0, 3)).toEqual([A, C, E]);
    expect(cells[1].props("initialCwd")).toBe("/c");
  });
});
