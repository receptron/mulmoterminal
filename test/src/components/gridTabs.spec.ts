import { describe, it, expect } from "vitest";
import type { RunCommand } from "../../../src/components/runCommand.js";
import {
  pageCount,
  pageSlice,
  resolveCellStatus,
  runningCount,
  addCell,
  setSession,
  setCwd,
  setCellAgent,
  closeCell,
  toggleExpand,
  switchPage,
  runCommand,
  runScriptInNewCell,
  insertCellAfter,
  shellCell,
  launchInCell,
  canMoveCell,
  setSortMode,
  moveCell,
  moveZoom,
  toggleZoom,
  nextAttention,
  nextAttentionUid,
  orderCells,
  visibleOrdered,
  activityStatus,
  countByStatus,
  cancelableLaunchUid,
  zoomedUid,
  visibleCells,
  parseGridState,
  migrateLegacy,
  initialState,
  type CellStatus,
  type GridState,
  type Cell,
  gridStatusSummary,
} from "../../../src/components/gridTabs.js";

const U = (n: number) => `${String(n % 10).repeat(8)}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
const cell = (uid: number, session: string | null = null, cwd: string | null = null): Cell => ({ uid, session, cwd });
const running = (count: number): Cell[] => Array.from({ length: count }, (_, i) => cell(i, U(i)));
const make = (cells: Cell[], extra: Partial<GridState> = {}): GridState => ({
  cells,
  expanded: null,
  page: 0,
  nextUid: cells.length,
  sortMode: "manual",
  ...extra,
});

describe("pagination helpers", () => {
  it("pageCount is 1..n in chunks of 9", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(9)).toBe(1);
    expect(pageCount(10)).toBe(2);
    expect(pageCount(18)).toBe(2);
    expect(pageCount(19)).toBe(3);
  });
  it("pageSlice returns the page's window", () => {
    const xs = Array.from({ length: 11 }, (_, i) => i);
    expect(pageSlice(xs, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pageSlice(xs, 1)).toEqual([9, 10]);
  });
  it("runningCount counts non-null sessions", () => {
    expect(runningCount([cell(0, U(0)), cell(1), cell(2, U(2))])).toBe(2);
  });
});

describe("addCell", () => {
  it("appends a launch cell and jumps to its (last) page", () => {
    const s = addCell(make(running(9)));
    expect(s.cells).toHaveLength(10);
    expect(s.cells[9].session).toBeNull();
    expect(s.page).toBe(1); // overflowed to page 2
  });
  it("cancels an open launch cell (but never the sole entry cell)", () => {
    const open = make([...running(2), cell(2)]);
    expect(addCell(open).cells).toHaveLength(2);
    const entryOnly = make([cell(0)]);
    expect(addCell(entryOnly).cells).toHaveLength(1);
  });
  it("does not exceed MAX_TERMINALS", () => {
    const s = addCell(make(running(81)));
    expect(runningCount(s.cells)).toBe(81);
    expect(s.cells).toHaveLength(81);
  });
  it("zooms the new cell when a cell is currently zoomed", () => {
    const s = addCell(make(running(3), { expanded: 1 }));
    expect(s.cells).toHaveLength(4);
    expect(s.expanded).toBe(s.cells[3].uid); // the freshly appended cell
  });
  it("leaves the grid un-zoomed when nothing was zoomed", () => {
    expect(addCell(make(running(3))).expanded).toBeNull();
  });
  it("does not zoom the new cell when `expanded` is stale (points at no cell)", () => {
    // zoomedUid treats a dangling `expanded` as not-zoomed, so a new cell must not inherit it.
    const s = addCell(make(running(2), { expanded: 99 }));
    expect(s.expanded).toBe(99); // unchanged; zoomedUid() still resolves it to null
  });
});

describe("cancelableLaunchUid", () => {
  const CMD: RunCommand = { source: "script", index: 0, label: "Build", cwd: "/x" };
  it("is the trailing launch cell's uid when one is open beyond the entry cell", () => {
    expect(cancelableLaunchUid(make([...running(2), cell(7)]))).toBe(7);
  });
  it("is null for the sole entry cell (nothing to cancel)", () => {
    expect(cancelableLaunchUid(make([cell(0)]))).toBeNull();
  });
  it("is null when the last cell is occupied (running session or command)", () => {
    expect(cancelableLaunchUid(make(running(2)))).toBeNull();
    expect(cancelableLaunchUid(make([...running(1), { uid: 1, session: null, cwd: null, command: CMD }]))).toBeNull();
  });
});

describe("closeCell reflows across pages", () => {
  it("removes a cell and packs later cells forward (page 2 -> page 1)", () => {
    const s = make(running(10), { page: 0 }); // 10 terminals -> 2 pages
    expect(pageCount(s.cells.length)).toBe(2);
    const after = closeCell(s, 0); // close the first terminal
    expect(after.cells).toHaveLength(9); // the 10th flowed back onto page 1
    expect(pageCount(after.cells.length)).toBe(1);
    expect(after.cells.map((c) => c.uid)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("clamps the active page when a page disappears", () => {
    const s = make(running(10), { page: 1 });
    const after = closeCell(s, 0);
    expect(after.page).toBe(0);
  });
  it("keeps an entry cell after the last terminal closes", () => {
    const after = closeCell(make([cell(0, U(0))]), 0);
    expect(after.cells).toHaveLength(1);
    expect(after.cells[0].session).toBeNull();
  });
  it("un-zooms when the zoomed cell is closed with no on-screen order (fallback)", () => {
    const after = closeCell(make(running(2), { expanded: 0 }), 0);
    expect(after.expanded).toBeNull();
  });
  it("stays zoomed on the PREVIOUS cell when the zoomed cell is closed", () => {
    const after = closeCell(make(running(3), { expanded: 1 }), 1, [0, 1, 2]);
    expect(after.expanded).toBe(0);
  });
  it("stays zoomed on the NEXT cell when the FIRST (front) cell is closed", () => {
    const after = closeCell(make(running(3), { expanded: 0 }), 0, [0, 1, 2]);
    expect(after.expanded).toBe(1);
  });
  it("un-zooms when the last remaining cell is closed (no neighbour)", () => {
    const after = closeCell(make(running(1), { expanded: 0 }), 0, [0]);
    expect(after.expanded).toBeNull();
  });
  it("leaves the zoom untouched when a NON-zoomed cell is closed", () => {
    const after = closeCell(make(running(3), { expanded: 2 }), 0, [0, 1, 2]);
    expect(after.expanded).toBe(2);
  });
});

describe("moveZoom (Page Up / Page Down walk the zoom along the filmstrip)", () => {
  const order3 = [0, 1, 2];

  it("moves the zoom forward and back along the on-screen order", () => {
    expect(moveZoom(make(running(3), { expanded: 1 }), order3, 1).expanded).toBe(2);
    expect(moveZoom(make(running(3), { expanded: 1 }), order3, -1).expanded).toBe(0);
  });

  it("stops at either end instead of wrapping", () => {
    expect(moveZoom(make(running(3), { expanded: 2 }), order3, 1).expanded).toBe(2);
    expect(moveZoom(make(running(3), { expanded: 0 }), order3, -1).expanded).toBe(0);
  });

  it("does nothing when nothing is zoomed", () => {
    const s = make(running(3));
    expect(moveZoom(s, order3, 1)).toBe(s);
  });

  it("does nothing when `expanded` is stale (points at a cell that's gone)", () => {
    const s = make(running(3), { expanded: 99 });
    expect(moveZoom(s, order3, 1)).toBe(s);
  });

  it("does nothing when the zoomed cell isn't in the given order", () => {
    const s = make(running(3), { expanded: 2 });
    expect(moveZoom(s, [0, 1], 1)).toBe(s);
  });

  it("does nothing with an empty order", () => {
    const s = make(running(3), { expanded: 1 });
    expect(moveZoom(s, [], 1)).toBe(s);
  });

  it("refuses to zoom a uid the order mentions but the grid no longer has", () => {
    const s = make(running(2), { expanded: 1 });
    expect(moveZoom(s, [0, 1, 42], 1)).toBe(s);
  });

  it("collapsing after walking forward lands on the page holding the cell just viewed", () => {
    // 12 terminals = 2 pages. Zoomed on the last cell of page 0, stepping forward
    // crosses onto page 1.
    const s = make(running(12), { expanded: 8, page: 0 });
    const order = s.cells.map((c) => c.uid);
    const moved = moveZoom(s, order, 1);
    expect(moved.expanded).toBe(9);
    expect(toggleZoom(moved, order).page).toBe(1);
  });

  it("collapsing after walking backwards lands on the earlier page", () => {
    const s = make(running(12), { expanded: 9, page: 1 });
    const order = s.cells.map((c) => c.uid);
    const moved = moveZoom(s, order, -1);
    expect(moved.expanded).toBe(8);
    expect(toggleZoom(moved, order).page).toBe(0);
  });

  it("uses the ORDER's index for the page, not the cell's position in state.cells", () => {
    // "auto" sort can float a later cell to the front; the page must follow what the user
    // is actually looking at on screen.
    const s = make(running(12), { expanded: 11, page: 0 });
    const reversed = [...s.cells.map((c) => c.uid)].reverse(); // 11 is now index 0
    const after = moveZoom(s, reversed, 1);
    expect(after.expanded).toBe(10); // the next one in the ON-SCREEN order
    expect(after.page).toBe(0);
  });
});

describe("toggleZoom (the keyboard's way in and out of the zoom)", () => {
  it("collapses when something is zoomed", () => {
    expect(toggleZoom(make(running(3), { expanded: 1 }), [0, 1, 2]).expanded).toBeNull();
  });

  it("enlarges the FIRST cell in the on-screen order when nothing is zoomed", () => {
    // Page 0, so the page offset is 0 and the order's own first entry wins — this is what makes
    // the "auto" sort put the most-wanting-attention cell under the key.
    expect(toggleZoom(make(running(3)), [2, 0, 1]).expanded).toBe(2);
  });

  it("refuses to zoom with fewer than two running cells (same rule as toggleExpand)", () => {
    const s = make([cell(0, U(0)), cell(1)]); // one running + one empty launcher
    expect(toggleZoom(s, [0, 1])).toBe(s);
  });

  it("still collapses even with one running cell — ⤡ must always get you out", () => {
    expect(toggleZoom(make([cell(0, U(0))], { expanded: 0 }), [0]).expanded).toBeNull();
  });

  it("does nothing with an empty order", () => {
    const s = make(running(3));
    expect(toggleZoom(s, [])).toBe(s);
  });

  // The selection is the focused cell — one notion, not a second "last enlarged" memory that
  // could disagree with it. Collapse then re-expand keeps you on the same terminal because the
  // caller keeps the cursor there.
  it("enlarges the SELECTED cell, not the first of the page", () => {
    const s = make(running(12), { page: 0 });
    const order = s.cells.map((c) => c.uid);
    expect(toggleZoom(s, order, 5).expanded).toBe(5);
  });

  it("round-trips: collapsing then re-expanding the same selection returns to it", () => {
    const s = make(running(12), { page: 0, expanded: 5 });
    const order = s.cells.map((c) => c.uid);
    const collapsed = toggleZoom(s, order, 5);
    expect(collapsed.expanded).toBeNull();
    expect(toggleZoom(collapsed, order, 5).expanded).toBe(5);
  });

  it("falls back to the page's first cell when the selection is gone", () => {
    const s = make(running(12), { page: 1 });
    const order = s.cells.map((c) => c.uid);
    expect(toggleZoom(s, order, 99).expanded).toBe(9);
  });

  // Regression (caught on a real grid, not by the unit tests or the bots): entering the zoom
  // from page 2 enlarged a cell from page 1 and dragged the page back to 0 with it, so ⤡ then
  // dropped the user on the wrong tab. `order` is the whole un-paged list, so the entry index
  // has to be derived from the page being looked at.
  it("enlarges a cell ON THE CURRENT PAGE, not the first of the whole list", () => {
    const s = make(running(12), { page: 1 });
    const order = s.cells.map((c) => c.uid);
    const after = toggleZoom(s, order);
    expect(after.expanded).toBe(9); // first cell of page 1, not uid 0
    expect(toggleZoom(after, order).page).toBe(1); // and releasing stays on that tab
  });

  it("enlarges the first cell of the list when on the first page", () => {
    const s = make(running(12), { page: 0 });
    const order = s.cells.map((c) => c.uid);
    const after = toggleZoom(s, order);
    expect(after.expanded).toBe(0);
    expect(toggleZoom(after, order).page).toBe(0);
  });

  // The rule as the user stated it: the tab shown on release is decided by WHERE THE ENLARGED
  // CELL IS, not by remembering the page they zoomed in from. Reaching a page-1 cell (via the
  // filmstrip, a roster row, or a jump) and releasing must show page 1.
  it("decides the page from the enlarged cell, whatever page the zoom started on", () => {
    const s = make(running(12), { expanded: 10, page: 0 });
    expect(
      toggleZoom(
        s,
        s.cells.map((c) => c.uid),
      ).page,
    ).toBe(1);
  });

  it("keeps the current page when the enlarged cell is no longer in the order", () => {
    const s = make(running(12), { expanded: 10, page: 1 });
    expect(toggleZoom(s, [0, 1, 2]).page).toBe(1);
  });
});

describe("nextAttention (jump to a terminal that needs you)", () => {
  const status = (m: Record<number, CellStatus>): Record<number, CellStatus> => m;

  // F8 alone enlarges and collapses. This key only moves, so pressing it on a plain grid must
  // leave a plain grid — it brings the candidate's page on screen instead.
  it("NEVER enters the zoom from an un-zoomed grid", () => {
    const s = make(running(12), { page: 0 });
    const after = nextAttention(
      s,
      s.cells.map((c) => c.uid),
      status({ 10: "blocked" }),
    );
    expect(after.expanded).toBeNull();
    expect(after.page).toBe(1); // but the calling cell is now on screen
  });

  it("NEVER collapses the zoom either — it only moves which cell is enlarged", () => {
    const after = nextAttention(make(running(3), { expanded: 0 }), [0, 1, 2], status({ 2: "blocked" }));
    expect(after.expanded).toBe(2);
  });

  it("prefers blocked over done, even when done is nearer", () => {
    const after = nextAttention(make(running(3), { expanded: 0 }), [0, 1, 2], status({ 0: "idle", 1: "done", 2: "blocked" }));
    expect(after.expanded).toBe(2);
  });

  it("starts from the cell AFTER the zoomed one", () => {
    const st = status({ 0: "done", 1: "done", 2: "done" });
    expect(nextAttention(make(running(3), { expanded: 0 }), [0, 1, 2], st).expanded).toBe(1);
    expect(nextAttention(make(running(3), { expanded: 1 }), [0, 1, 2], st).expanded).toBe(2);
  });

  it("wraps around, so repeated presses cycle instead of stopping at the end", () => {
    const st = status({ 0: "done", 1: "idle", 2: "done" });
    expect(nextAttention(make(running(3), { expanded: 2 }), [0, 1, 2], st).expanded).toBe(0);
  });

  it("stays put when the zoomed cell is the ONLY one wanting attention", () => {
    const st = status({ 0: "idle", 1: "blocked", 2: "idle" });
    expect(nextAttention(make(running(3), { expanded: 1 }), [0, 1, 2], st).expanded).toBe(1);
  });

  it("falls back to an idle cell when nothing is calling, so the key still moves", () => {
    const after = nextAttention(make(running(3), { expanded: 0 }), [0, 1, 2], status({ 0: "idle", 1: "working", 2: "idle" }));
    expect(after.expanded).toBe(2); // skips the working cell at index 1
  });

  it("still prefers a calling cell over a nearer idle one", () => {
    const after = nextAttention(make(running(3), { expanded: 0 }), [0, 1, 2], status({ 0: "idle", 1: "idle", 2: "done" }));
    expect(after.expanded).toBe(2);
  });

  it("does nothing when every other cell is mid-turn — working is the one place not to go", () => {
    const s = make(running(2));
    expect(nextAttention(s, [0, 1], status({ 0: "working", 1: "working" }))).toBe(s);
  });

  it("treats a cell with no reported status as idle, so a fresh grid still moves", () => {
    const after = nextAttention(make(running(3), { expanded: 0 }), [0, 1, 2], status({}));
    expect(after.expanded).toBe(1);
  });

  it("does nothing with an empty order", () => {
    const s = make(running(3));
    expect(nextAttention(s, [], {})).toBe(s);
  });

  // The trailing launch cell is not a terminal. It also never reports a status, so without an
  // explicit skip it reads as `idle` and gets picked constantly — including as the cell to
  // ENLARGE while zoomed. `ensureEntry`/`addCell` mean one is almost always present.
  it("never picks the empty launch cell, even when it is the only idle thing left", () => {
    const s = make([cell(0, U(0)), cell(1)]); // one running terminal + the trailing launcher
    expect(nextAttentionUid(s, [0, 1], { 0: "working" }, null)).toBeNull();
  });

  it("picks the idle TERMINAL and skips the launcher beside it", () => {
    const s = make([cell(0, U(0)), cell(1, U(1)), cell(2)]); // two terminals + a launcher
    expect(nextAttentionUid(s, [0, 1, 2], { 0: "working" }, null)).toBe(1);
  });

  it("does not enlarge a launcher when zoomed and nothing else is idle", () => {
    const s = make([cell(0, U(0)), cell(1, U(1)), cell(2)], { expanded: 1 });
    const after = nextAttention(s, [0, 1, 2], { 0: "working", 1: "working" }, null);
    expect(after.expanded).toBe(1); // unchanged — never the launcher at uid 2
  });

  it("still counts a command or launcher-backed cell as a real terminal", () => {
    // Occupied means session OR command OR launcher — a shell cell is somewhere worth going.
    const s = make([cell(0, U(0)), { uid: 1, session: null, cwd: "/w", launcher: { shell: true, label: "shell" } }]);
    expect(nextAttentionUid(s, [0, 1], { 0: "working" }, null)).toBe(1);
  });

  it("reports the uid it would move to, so the caller can focus that terminal", () => {
    const st = status({ 0: "idle", 1: "working", 2: "blocked" });
    expect(nextAttentionUid(make(running(3)), [0, 1, 2], st)).toBe(2);
    // Same rotation as nextAttention: starts after the zoomed cell. Here every remaining cell
    // is idle or working, so it settles on the idle one rather than the mid-turn cell.
    expect(nextAttentionUid(make(running(3), { expanded: 2 }), [0, 1, 2], status({ 0: "idle", 1: "working", 2: "idle" }))).toBe(0);
  });

  // The bug this parameter exists for: without an origin the rotation always restarts at index
  // 0, so a second press picks the same cell and the key looks dead on a plain grid.
  it("rotates from the FOCUSED cell when nothing is zoomed", () => {
    const s = make(running(4));
    const st = status({ 0: "idle", 1: "idle", 2: "idle", 3: "idle" });
    expect(nextAttentionUid(s, [0, 1, 2, 3], st, null)).toBe(0);
    expect(nextAttentionUid(s, [0, 1, 2, 3], st, 0)).toBe(1);
    expect(nextAttentionUid(s, [0, 1, 2, 3], st, 1)).toBe(2);
    expect(nextAttentionUid(s, [0, 1, 2, 3], st, 3)).toBe(0); // wraps
  });

  it("prefers the zoomed cell over the focused one as the origin", () => {
    const s = make(running(4), { expanded: 2 });
    const st = status({ 0: "idle", 1: "idle", 2: "idle", 3: "idle" });
    expect(nextAttentionUid(s, [0, 1, 2, 3], st, 0)).toBe(3); // after the ZOOMED cell, not 1
  });

  it("reports null when there is nowhere to move", () => {
    expect(nextAttentionUid(make(running(2)), [0, 1], status({ 0: "working", 1: "working" }))).toBeNull();
    expect(nextAttentionUid(make(running(2)), [], {})).toBeNull();
  });

  it("leaves an un-zoomed grid alone when the candidate is already on screen", () => {
    const s = make(running(3), { page: 0 });
    const after = nextAttention(s, [0, 1, 2], status({ 1: "blocked" }));
    expect(after.expanded).toBeNull();
    expect(after.page).toBe(0);
  });

  it("collapsing after a jump made WHILE ZOOMED lands on that cell's page", () => {
    const s = make(running(12), { expanded: 0 });
    const order = s.cells.map((c) => c.uid);
    const after = nextAttention(s, order, status({ 10: "blocked" }));
    expect(after.expanded).toBe(10);
    expect(toggleZoom(after, order).page).toBe(1);
  });

  // Regression: the caller must hand over the WHOLE ordered list, not the visible page. Given a
  // page slice, a cell calling from another page is invisible here and the page math below is
  // computed against the wrong origin.
  it("reaches a calling cell on ANOTHER page while un-zoomed", () => {
    const s = make(running(12), { page: 0 });
    const order = s.cells.map((c) => c.uid);
    const after = nextAttention(s, order, status({ 11: "blocked" }));
    expect(after.expanded).toBeNull(); // still a grid
    expect(after.page).toBe(1); // showing the page that was calling
  });
});

describe("setSession / setCwd / toggleExpand", () => {
  it("promotes a launch cell to running", () => {
    const s = setSession(make([cell(0)]), 0, U(5));
    expect(s.cells[0].session).toBe(U(5));
  });
  it("setCwd updates the matching cell", () => {
    expect(setCwd(make([cell(0)]), 0, "/x").cells[0].cwd).toBe("/x");
  });
  it("toggleExpand flips the zoom uid", () => {
    expect(toggleExpand(make(running(2)), 1).expanded).toBe(1);
    expect(toggleExpand(make(running(2), { expanded: 1 }), 1).expanded).toBeNull();
  });

  // #374: zooming shows one cell big with the others as a filmstrip, so with nothing to
  // switch to it swaps a working layout for an empty filmstrip and squeezes the terminal's
  // status bar and input off the bottom of the viewport, for no gain.
  it("refuses to zoom when there is only one occupied cell", () => {
    const single = make([cell(0, U(0)), cell(1)]);
    expect(toggleExpand(single, 0)).toBe(single);
  });

  it("refuses to zoom a grid of nothing but launch cells", () => {
    const empty = make([cell(0), cell(1)]);
    expect(toggleExpand(empty, 0)).toBe(empty);
  });

  it("zooms as soon as a second cell is occupied", () => {
    expect(toggleExpand(make([cell(0, U(0)), cell(1, U(1)), cell(2)]), 0).expanded).toBe(0);
  });

  // Whatever a state got into, the collapse button has to get out of it — including a state
  // that was zoomed when its sibling closed.
  it("always allows collapsing, even down to one cell", () => {
    const stranded = make([cell(0, U(0)), cell(1)], { expanded: 0 });
    expect(toggleExpand(stranded, 0).expanded).toBeNull();
  });
});

// `agent` is how a reloaded cell knows to reconnect via /ws/codex, and Claude is the ABSENT
// case — so switching back to it has to REMOVE the key. A persisted grid round-trips through
// JSON, where `agent: undefined` and no key are indistinguishable on the way out but only the
// latter can be written; exactOptionalPropertyTypes is what makes the difference expressible.
describe("setCellAgent", () => {
  it("records codex on the matching cell", () => {
    expect(setCellAgent(make([cell(0, U(0)), cell(1, U(1))]), 0, "codex").cells[0].agent).toBe("codex");
  });

  it("leaves the other cells alone", () => {
    const s = setCellAgent(make([cell(0, U(0)), cell(1, U(1))]), 0, "codex");
    expect(Object.hasOwn(s.cells[1], "agent")).toBe(false);
  });

  it("drops the key when switching back to claude, rather than setting it undefined", () => {
    const codex = setCellAgent(make([cell(0, U(0))]), 0, "codex");
    const claude = setCellAgent(codex, 0, "claude");
    expect(Object.hasOwn(claude.cells[0], "agent")).toBe(false);
  });

  it("keeps the rest of the cell intact across the switch", () => {
    const s = setCellAgent(make([cell(0, U(0), "/repo")]), 0, "codex");
    expect(s.cells[0]).toMatchObject({ uid: 0, session: U(0), cwd: "/repo" });
  });
});

describe("switchPage", () => {
  it("is a no-op when selecting the already-active page (keeps zoom + launch cell)", () => {
    const s = make([...running(9), cell(9)], { page: 1, expanded: 3 });
    expect(switchPage(s, 1)).toBe(s);
  });
  it("drops an abandoned trailing launch cell and clears zoom", () => {
    const s = make([...running(9), cell(9)], { page: 1, expanded: 0 });
    const after = switchPage(s, 0);
    expect(after.cells).toHaveLength(9); // launch cell trimmed
    expect(after.expanded).toBeNull();
    expect(after.page).toBe(0);
  });
});

describe("runCommand (script command cells)", () => {
  const CMD: RunCommand = { source: "script", index: 0, label: "Build", cwd: "/x" };
  const cmdCell = (uid: number): Cell => ({ uid, session: null, cwd: null, command: CMD });

  it("attaches a command to a launch cell, turning it into a command cell", () => {
    const s = runCommand(make([cell(0)]), 0, CMD);
    expect(s.cells[0].command).toEqual(CMD);
    expect(s.cells[0].session).toBeNull();
  });
  it("counts a command cell as running (toward the cap)", () => {
    expect(runningCount([cell(0, U(0)), cmdCell(1), cell(2)])).toBe(2);
  });
  it("a trailing command cell is not a cancellable launch cell — '+' appends", () => {
    const s = addCell(make([...running(2), cmdCell(2)]));
    expect(s.cells).toHaveLength(4); // appended a launch cell, kept the command cell
    expect(s.cells[3].session).toBeNull();
    expect(s.cells[3].command).toBeUndefined();
  });
  it("switchPage keeps a trailing command cell (only abandons an empty launcher)", () => {
    const after = switchPage(make([...running(9), cmdCell(9)], { page: 1 }), 0);
    expect(after.cells).toHaveLength(10);
  });
});

describe("launchInCell (persistent launcher cells)", () => {
  const L = { index: 1, label: "Shell" };

  it("attaches a launcher + cwd to a launch cell", () => {
    const s = launchInCell(make([cell(0)]), 0, L, "/proj");
    expect(s.cells[0].launcher).toEqual(L);
    expect(s.cells[0].cwd).toBe("/proj");
    expect(s.cells[0].session).toBeNull(); // id arrives later via setSession
  });
  it("counts a launcher cell as running, and it's not a cancellable launch cell", () => {
    const withLauncher = launchInCell(make([cell(0), cell(1)]), 0, L, "/p");
    expect(runningCount(withLauncher.cells)).toBe(1);
    // A trailing launcher cell must not read as an empty (cancellable) launch cell.
    const s = addCell(make([launchInCell(make([cell(0)]), 0, L, "/p").cells[0]]));
    expect(s.cells).toHaveLength(2);
  });
  it("persists a launcher cell (session + launcher) across parseGridState", () => {
    const withId = setSession(launchInCell(make([cell(0)]), 0, L, "/p"), 0, U(3));
    const restored = parseGridState(JSON.stringify(withId));
    expect(restored?.cells[0]).toMatchObject({ session: U(3), cwd: "/p", launcher: L });
  });
  it("drops a malformed persisted launcher to null", () => {
    const raw = JSON.stringify({ cells: [{ session: U(4), cwd: "/p", launcher: { label: "x" } }], page: 0, sortMode: "manual" });
    expect(parseGridState(raw)?.cells[0].launcher).toBeNull();
  });
});

describe("insertCellAfter", () => {
  it("inserts a new cell right after the given uid, minting the next uid", () => {
    const s = insertCellAfter(make(running(3)), 1, { session: null, cwd: "/x" });
    expect(s.cells).toHaveLength(4);
    expect(s.cells.map((c) => c.uid)).toEqual([0, 1, 3, 2]); // NEW (uid 3) lands after uid 1
    expect(s.cells[2]).toMatchObject({ session: null, cwd: "/x", uid: 3 });
  });
  it("appends when the uid is not found (e.g. no triggering cell)", () => {
    const s = insertCellAfter(make(running(2)), -1, { session: null, cwd: null });
    expect(s.cells).toHaveLength(3);
    expect(s.cells[2].uid).toBe(2);
  });
  it("jumps to the new cell's page when it lands on a later page", () => {
    const s = insertCellAfter(make(running(9)), 8, { session: null, cwd: null }); // after index 8 -> index 9 -> page 1
    expect(s.cells).toHaveLength(10);
    expect(s.page).toBe(1);
  });
  it("is a no-op at the terminal cap", () => {
    expect(insertCellAfter(make(running(81)), 0, { session: null, cwd: null }).cells).toHaveLength(81);
  });
});

describe("runScriptInNewCell (Run button → adjacent spare cell)", () => {
  const CMD: RunCommand = { source: "script", index: 1, label: "Dev server", cwd: "/x" };

  it("opens the command in a new cell right after the triggering cell", () => {
    const s = runScriptInNewCell(make(running(3)), 0, CMD);
    expect(s.cells).toHaveLength(4);
    expect(s.cells[1]).toMatchObject({ session: null, command: CMD }); // after uid 0 (index 0)
  });
  it("appends when there is no triggering cell (afterUid -1)", () => {
    const s = runScriptInNewCell(make(running(2)), -1, CMD);
    expect(s.cells).toHaveLength(3);
    expect(s.cells[2].command).toEqual(CMD);
  });
  it("is a no-op at the terminal cap", () => {
    expect(runScriptInNewCell(make(running(81)), 0, CMD).cells).toHaveLength(81);
  });
});

describe("shellCell", () => {
  it("is a launcher cell for the OS default shell ($SHELL)", () => {
    expect(shellCell("/proj")).toEqual({ session: null, cwd: "/proj", launcher: { shell: true, label: "shell" } });
  });
});

describe("setSortMode / moveCell (manual reorder)", () => {
  it("setSortMode flips between manual and auto", () => {
    expect(setSortMode(make(running(2)), "auto").sortMode).toBe("auto");
    expect(setSortMode(make(running(2), { sortMode: "auto" }), "manual").sortMode).toBe("manual");
  });
  it("moveCell swaps a cell with its right/left neighbour", () => {
    const s = make(running(3));
    expect(moveCell(s, 0, 1).cells.map((c) => c.uid)).toEqual([1, 0, 2]); // 0 right
    expect(moveCell(s, 2, -1).cells.map((c) => c.uid)).toEqual([0, 2, 1]); // 2 left
  });
  it("moveCell is a no-op past either end", () => {
    const s = make(running(3));
    expect(moveCell(s, 0, -1)).toBe(s); // already leftmost
    expect(moveCell(s, 2, 1)).toBe(s); // already rightmost
    expect(moveCell(s, 99, 1)).toBe(s); // unknown uid
  });
  it("moveCell won't push a cell past the trailing launch cell (it stays last)", () => {
    const s = make([...running(2), cell(2)]); // cell 2 is the trailing launcher
    expect(moveCell(s, 1, 1)).toBe(s);
  });

  // canMoveCell drives the enabled/disabled state of the roster's up/down menu items, so it must
  // report exactly the moves moveCell would perform (used to gate them in TerminalGrid).
  it("canMoveCell allows a swap in the middle", () => {
    const cells = running(3);
    expect(canMoveCell(cells, 1, -1)).toBe(true);
    expect(canMoveCell(cells, 1, 1)).toBe(true);
  });
  it("canMoveCell forbids moving off either end or an unknown uid", () => {
    const cells = running(3);
    expect(canMoveCell(cells, 0, -1)).toBe(false); // already first
    expect(canMoveCell(cells, 2, 1)).toBe(false); // already last
    expect(canMoveCell(cells, 99, 1)).toBe(false); // unknown uid
  });
  it("canMoveCell forbids swapping past the trailing launch cell", () => {
    const cells = [...running(2), cell(2)]; // cell 2 is the trailing launcher
    expect(canMoveCell(cells, 1, 1)).toBe(false); // would push cell 1 into the launcher's last slot
    expect(canMoveCell(cells, 0, 1)).toBe(true); // cell 0 down into cell 1 is fine
  });
});

describe("activityStatus", () => {
  it("splits waiting into blocked (Notification) vs done (Stop)", () => {
    expect(activityStatus(false, true, "Notification")).toBe("blocked");
    expect(activityStatus(false, true, "Stop")).toBe("done");
    expect(activityStatus(false, true, null)).toBe("done"); // any non-Notification waiting -> done
  });
  it("is working when only working, idle when neither", () => {
    expect(activityStatus(true, false, "UserPromptSubmit")).toBe("working");
    expect(activityStatus(false, false, null)).toBe("idle");
  });
  it("waiting wins over working (a permission pause mid-turn is blocked)", () => {
    expect(activityStatus(true, true, "Notification")).toBe("blocked");
  });
});

describe("countByStatus", () => {
  it("tallies occupied cells by status, skipping empty launchers", () => {
    const cells = [...running(4), cell(4)]; // uid 4 = empty launcher
    const counts = countByStatus(cells, { 0: "blocked", 1: "blocked", 2: "done", 3: "working" });
    expect(counts).toEqual({ blocked: 2, done: 1, working: 1, idle: 0 });
  });
  it("treats an unreported occupied cell as idle", () => {
    expect(countByStatus(running(2), { 0: "working" })).toEqual({ blocked: 0, done: 0, working: 1, idle: 1 });
  });
  it("counts a command cell (occupied, no session)", () => {
    const cmd: Cell = { uid: 0, session: null, cwd: null, command: { source: "script", index: 0, label: "Build", cwd: "/x" } };
    expect(countByStatus([cmd], { 0: "working" })).toEqual({ blocked: 0, done: 0, working: 1, idle: 0 });
  });
});

describe("orderCells (auto attention sort)", () => {
  const status = (m: Record<number, CellStatus>) => m;
  it("manual mode returns the list unchanged", () => {
    const cells = running(3);
    expect(orderCells(cells, status({ 0: "working", 1: "blocked", 2: "idle" }), "manual")).toBe(cells);
  });
  it("auto sorts blocked -> done -> idle -> working, launch cells last", () => {
    const cells = [...running(4), cell(4)]; // uid 4 is an empty launch cell
    const ordered = orderCells(cells, status({ 0: "working", 1: "blocked", 2: "done", 3: "idle" }), "auto");
    expect(ordered.map((c) => c.uid)).toEqual([1, 2, 3, 0, 4]);
  });
  it("is stable within a bucket (equal status keeps manual order)", () => {
    const cells = running(4);
    const ordered = orderCells(cells, status({ 0: "working", 1: "working", 2: "working", 3: "working" }), "auto");
    expect(ordered.map((c) => c.uid)).toEqual([0, 1, 2, 3]);
  });
  it("treats an unreported uid as idle", () => {
    const cells = running(2);
    const ordered = orderCells(cells, status({ 0: "working" }), "auto");
    expect(ordered.map((c) => c.uid)).toEqual([1, 0]); // uid 1 (idle) before uid 0 (working)
  });
});

// The rank comes from the DIRECTORY (.mulmoterminal.json orderPriority), so it is keyed by cwd
// and several cells in one directory necessarily share it.
describe("orderCells (priority sort)", () => {
  const NO_STATUS = {};
  // uid n lives in /p<n>, so a cell's uid and its directory line up in the expectations.
  const inDirs = (count: number): Cell[] => Array.from({ length: count }, (_, i) => cell(i, U(i), `/p${i}`));

  it("sorts ascending by the directory's priority", () => {
    const ordered = orderCells(inDirs(3), NO_STATUS, "priority", { "/p0": 30, "/p1": 10, "/p2": 20 });
    expect(ordered.map((c) => c.uid)).toEqual([1, 2, 0]);
  });

  // Adding the key to ONE project must not displace the others relative to each other.
  it("puts directories with no priority last, in their existing order", () => {
    const ordered = orderCells(inDirs(4), NO_STATUS, "priority", { "/p2": 1 });
    expect(ordered.map((c) => c.uid)).toEqual([2, 0, 1, 3]);
  });

  it("keeps the manual order among equal priorities, including cells sharing one directory", () => {
    const cells = [cell(0, U(0), "/a"), cell(1, U(1), "/b"), cell(2, U(2), "/a")];
    const ordered = orderCells(cells, NO_STATUS, "priority", { "/a": 5, "/b": 5 });
    expect(ordered.map((c) => c.uid)).toEqual([0, 1, 2]);
  });

  it("is a no-op ordering when nothing sets a priority", () => {
    const ordered = orderCells(inDirs(3), NO_STATUS, "priority", {});
    expect(ordered.map((c) => c.uid)).toEqual([0, 1, 2]);
  });

  // An empty slot is never what you want first — and it can't be held back by its key alone,
  // since every unset directory already ranks at Infinity.
  it("keeps an empty launch cell last even behind unset directories", () => {
    // The launch cell starts FIRST, and /p0 sets nothing — so only the launch-last level can
    // separate them; both rank at Infinity on the key alone.
    const cells = [cell(9), cell(0, U(0), "/p0"), cell(1, U(1), "/p1")];
    const ordered = orderCells(cells, NO_STATUS, "priority", { "/p1": 7 });
    expect(ordered.map((c) => c.uid)).toEqual([1, 0, 9]);
  });

  it("honours negative ranks, so a project can sort ahead of everything at 0", () => {
    const ordered = orderCells(inDirs(3), NO_STATUS, "priority", { "/p0": 0, "/p1": -5, "/p2": 3 });
    expect(ordered.map((c) => c.uid)).toEqual([1, 0, 2]);
  });

  it("ignores the priority map entirely in the other two modes", () => {
    const cells = inDirs(3);
    const priorities = { "/p2": -100 };
    expect(orderCells(cells, NO_STATUS, "manual", priorities)).toBe(cells);
    expect(orderCells(cells, { 0: "blocked" }, "auto", priorities).map((c) => c.uid)).toEqual([0, 1, 2]);
  });
});

describe("visibleOrdered (attention-sort the whole list, then page)", () => {
  it("floats a blocked cell from any page onto the first page", () => {
    // 12 cells over 2 pages. uid 10 starts on page 2; once blocked it sorts to the
    // front and lands on page 1, while the working uid 0 sinks off page 1.
    const s = make(running(12), { page: 0, sortMode: "auto" });
    const statusByUid: Record<number, CellStatus> = { 0: "working", 1: "blocked", 10: "blocked" };
    const page1 = visibleOrdered(s, statusByUid).map((c) => c.uid);
    expect(page1.slice(0, 2)).toEqual([1, 10]); // both blocked cells, base order, up front
    expect(page1).not.toContain(0); // working uid 0 sank to page 2
    expect(page1).toHaveLength(9);
  });
  it("manual mode leaves the on-screen order untouched", () => {
    const s = make(running(4), { sortMode: "manual" });
    expect(visibleOrdered(s, { 0: "working", 3: "blocked" }).map((c) => c.uid)).toEqual([0, 1, 2, 3]);
  });
  it("orders the whole list (the filmstrip) while zoomed", () => {
    const s = make(running(12), { page: 0, expanded: 11, sortMode: "auto" });
    expect(visibleOrdered(s, { 11: "blocked" }).map((c) => c.uid)[0]).toBe(11);
  });
  // Pins that the priority map reaches the sort THROUGH this function: with it the ranked
  // directory leads, and dropping it silently ranks everything as unset — which would have
  // this disagree with the grid rather than fail loudly.
  it("applies the priority map, and reads every directory as unset without one", () => {
    const cells = [cell(0, U(0), "/x"), cell(1, U(1), "/y")];
    const s = make(cells, { sortMode: "priority" });
    expect(visibleOrdered(s, {}, { "/y": 1 }).map((c) => c.uid)).toEqual([1, 0]);
    expect(visibleOrdered(s, {}).map((c) => c.uid)).toEqual([0, 1]);
  });
});

describe("zoomedUid / visibleCells", () => {
  it("zoomedUid returns the expanded uid, or null when nothing is zoomed", () => {
    expect(zoomedUid(make(running(3)))).toBeNull();
    expect(zoomedUid(make(running(3), { expanded: 1 }))).toBe(1);
  });
  it("zoomedUid is null when expanded points at a missing cell", () => {
    expect(zoomedUid(make(running(2), { expanded: 99 }))).toBeNull();
  });
  it("visibleCells is the active page's slice when nothing is zoomed", () => {
    const s = make(running(12)); // 2 pages
    expect(visibleCells(s).map((c) => c.uid)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(visibleCells({ ...s, page: 1 }).map((c) => c.uid)).toEqual([9, 10, 11]);
  });
  it("visibleCells is the WHOLE list while a cell is zoomed (all tabs in the strip)", () => {
    const s = make(running(12), { page: 1, expanded: 10 });
    expect(visibleCells(s)).toHaveLength(12);
  });
  it("visibleCells falls back to the page slice when expanded is stale", () => {
    const s = make(running(12), { page: 1, expanded: 99 });
    expect(visibleCells(s).map((c) => c.uid)).toEqual([9, 10, 11]);
  });
});

describe("parseGridState / migrateLegacy / initialState", () => {
  it("keeps running cells, renumbers uids, and drops malformed entries", () => {
    const raw = JSON.stringify({ cells: [cell(0, U(0)), { uid: 1, session: "bad", cwd: null }, cell(2, U(2))], expanded: 2, page: 0, nextUid: 3 });
    const s = parseGridState(raw);
    if (!s) throw new Error("expected parsed state");
    expect(s.cells.map((c) => c.session)).toEqual([U(0), U(2)]); // "bad" session dropped
    expect(s.cells.map((c) => c.uid)).toEqual([0, 1]); // renumbered from position
    expect(s.expanded).toBe(1); // old uid 2 -> new index 1
  });
  it("returns null for missing/corrupt input", () => {
    expect(parseGridState(null)).toBeNull();
    expect(parseGridState("not json{")).toBeNull();
  });
  it("round-trips a persisted sortMode and defaults to manual", () => {
    const cells = [cell(0, U(0))];
    expect(parseGridState(JSON.stringify({ cells, sortMode: "auto" }))?.sortMode).toBe("auto");
    expect(parseGridState(JSON.stringify({ cells }))?.sortMode).toBe("manual"); // absent -> manual
    expect(parseGridState(JSON.stringify({ cells, sortMode: "bogus" }))?.sortMode).toBe("manual"); // invalid -> manual
  });
  it("constrains a malformed persisted page to a valid integer", () => {
    const cells = Array.from({ length: 18 }, (_, i) => cell(i, U(i))); // 2 pages
    const s = parseGridState(JSON.stringify({ cells, expanded: null, page: 1.5, nextUid: 18 }));
    if (!s) throw new Error("expected parsed state");
    expect(Number.isInteger(s.page)).toBe(true);
    expect(s.page).toBe(0);
  });
  it("renumbers duplicate/oversized persisted uids and keeps nextUid safe", () => {
    const raw = JSON.stringify({
      cells: [
        cell(0, U(0)),
        cell(0, U(1)), // duplicate uid 0
        { uid: 5, session: null, cwd: null }, // empty launch cell — dropped
        { uid: Number.MAX_SAFE_INTEGER, session: U(2), cwd: null }, // oversized uid
      ],
      expanded: null,
      page: 0,
      nextUid: 1,
    });
    const s = parseGridState(raw);
    if (!s) throw new Error("expected parsed state");
    expect(s.cells.map((c) => c.session)).toEqual([U(0), U(1), U(2)]); // empty dropped, all running kept
    expect(s.cells.map((c) => c.uid)).toEqual([0, 1, 2]); // renumbered — no collision
    expect(s.nextUid).toBe(3);
    expect(Number.isSafeInteger(s.nextUid)).toBe(true);
  });
  it("migrates the legacy single-grid shape into the flat list", () => {
    const legacy = JSON.stringify({ sessions: [U(0), null, U(2), null], cwds: ["/a", null, "/c", null], expanded: 1 });
    const s = migrateLegacy(legacy);
    if (!s) throw new Error("expected migration");
    expect(s.cells.map((c) => c.session)).toEqual([U(0), U(2)]);
    expect(s.cells[1].cwd).toBe("/c");
    expect(s.expanded).toBe(s.cells[1].uid); // old position 1 -> the 2nd running cell
  });
  it("initialState prefers current, then legacy, then a fresh entry", () => {
    expect(initialState(JSON.stringify({ cells: [cell(0, U(0))] }), null).migrated).toBe(false);
    const fromLegacy = initialState(null, JSON.stringify({ sessions: [U(0)] }));
    expect(fromLegacy.migrated).toBe(true);
    const fresh = initialState(null, null);
    expect(fresh.state.cells).toHaveLength(1);
    expect(fresh.state.cells[0].session).toBeNull();
  });
});

describe("resolveCellStatus", () => {
  const cell = (uid: number, session: string | null) => ({ uid, session });

  // The server's activity for the cell's session wins: it is the only source that knows a
  // turn is blocked, which is what auto mode sorts on.
  it("prefers the session's live status over the cell's own", () => {
    const out = resolveCellStatus([cell(1, "s1")], new Map<string, CellStatus>([["s1", "blocked"]]), { 1: "working" });
    expect(out[1]).toBe("blocked");
  });

  // Command cells have no session id, and a just-launched cell has none yet — without the
  // fallback they would read idle and sort past cells that need nothing.
  it("falls back to the cell's own status when it has no session", () => {
    expect(resolveCellStatus([cell(2, null)], new Map<string, CellStatus>(), { 2: "working" })[2]).toBe("working");
  });

  it("falls back when the session has no activity yet", () => {
    expect(resolveCellStatus([cell(3, "unknown")], new Map<string, CellStatus>(), { 3: "working" })[3]).toBe("working");
  });

  it("lands on idle when nothing knows anything", () => {
    expect(resolveCellStatus([cell(4, null)], new Map<string, CellStatus>(), {})[4]).toBe("idle");
  });

  it("answers for every cell, not just the ones with activity", () => {
    const out = resolveCellStatus([cell(1, "s1"), cell(2, null), cell(3, "s3")], new Map<string, CellStatus>([["s1", "blocked"]]), {});
    expect(Object.keys(out).sort()).toEqual(["1", "2", "3"]);
  });

  it("keys by uid, so two cells on the same session can still differ elsewhere", () => {
    const out = resolveCellStatus([cell(1, "s1"), cell(2, "s1")], new Map<string, CellStatus>([["s1", "working"]]), {});
    expect([out[1], out[2]]).toEqual(["working", "working"]);
  });

  it("returns an empty map for no cells", () => {
    expect(resolveCellStatus([], new Map<string, CellStatus>(), {})).toEqual({});
  });
});

describe("gridStatusSummary", () => {
  const counts = (over: Partial<Record<"blocked" | "done" | "working" | "idle", number>> = {}) => ({ blocked: 0, done: 0, working: 0, idle: 0, ...over });

  it("shows nothing when there are no counts", () => {
    expect(gridStatusSummary(null)).toEqual({ show: false, title: "" });
    expect(gridStatusSummary(undefined)).toEqual({ show: false, title: "" });
  });

  // The asymmetry this exists for: idle alone does not raise the badge — a wholly-idle grid
  // has nothing to triage, and the strip would be noise on every quiet session.
  it("does not show for a grid that is only idle", () => {
    expect(gridStatusSummary(counts({ idle: 9 })).show).toBe(false);
  });

  it.each(["blocked", "done", "working"] as const)("shows as soon as one cell is %s", (key) => {
    expect(gridStatusSummary(counts({ [key]: 1 })).show).toBe(true);
  });

  // …but idle IS in the tooltip text once the strip is up.
  it("includes idle in the title even though it does not raise the badge", () => {
    const s = gridStatusSummary(counts({ working: 1, idle: 3 }));
    expect(s.show).toBe(true);
    expect(s.title).toBe("1 working · 3 idle");
  });

  // Reading order: blocked (needs you) first.
  it("orders the parts blocked, done, working, idle", () => {
    expect(gridStatusSummary(counts({ blocked: 1, done: 2, working: 3, idle: 4 })).title).toBe("1 need input · 2 done (review) · 3 working · 4 idle");
  });

  it("omits a zero count from the title", () => {
    expect(gridStatusSummary(counts({ blocked: 2, working: 1 })).title).toBe("2 need input · 1 working");
  });
});

// The rules written at the top of the zoom section in gridTabs.ts. Each was broken at least
// once while building #829, so they are pinned as rules rather than as one-off cases: a future
// action that quietly violates one fails here instead of in someone's grid.
describe("zoom invariants (#829)", () => {
  const order12 = Array.from({ length: 12 }, (_, i) => i);
  const allIdle: Record<number, CellStatus> = {};

  // Invariant 1 — only toggleZoom changes WHETHER the grid is zoomed.
  const movements: Array<[string, (s: GridState) => GridState]> = [
    ["moveZoom(+1)", (s) => moveZoom(s, order12, 1)],
    ["moveZoom(-1)", (s) => moveZoom(s, order12, -1)],
    ["nextAttention", (s) => nextAttention(s, order12, allIdle, 3)],
  ];

  it.each(movements)("%s leaves an un-zoomed grid un-zoomed", (_label, apply) => {
    expect(apply(make(running(12), { page: 0 })).expanded).toBeNull();
  });

  it.each(movements)("%s leaves a zoomed grid zoomed", (_label, apply) => {
    expect(apply(make(running(12), { expanded: 5 })).expanded).not.toBeNull();
  });

  it.each(movements)("%s never adds or removes a terminal", (_label, apply) => {
    const s = make(running(12), { expanded: 5 });
    expect(apply(s).cells).toHaveLength(s.cells.length);
  });

  it("toggleZoom is the one action that flips it, in both directions", () => {
    const s = make(running(12), { page: 0 });
    const zoomed = toggleZoom(s, order12, 4);
    expect(zoomed.expanded).toBe(4);
    expect(toggleZoom(zoomed, order12, 4).expanded).toBeNull();
  });

  // Invariant 3 — page is decided only on release, and only from the enlarged cell.
  it.each(movements)("%s does not touch the page", (_label, apply) => {
    const s = make(running(12), { expanded: 5, page: 1 });
    expect(apply(s).page).toBe(1);
  });

  it("releasing the zoom sets the page from the enlarged cell, ignoring where it started", () => {
    for (const [uid, expected] of [
      [0, 0],
      [8, 0],
      [9, 1],
      [11, 1],
    ]) {
      const s = make(running(12), { expanded: uid, page: 0 });
      expect(toggleZoom(s, order12, uid).page).toBe(expected);
    }
  });

  // Invariant 5 — entry needs a second running cell; leaving never refuses.
  it("refuses to ENTER the zoom with one running cell", () => {
    const lonely = make([cell(0, U(0)), cell(1)]); // one running + an empty launcher
    expect(toggleZoom(lonely, [0, 1], 0)).toBe(lonely);
  });

  // nextAttention needs no such guard: by invariant 1 it never enters the zoom in the first
  // place, so on a one-cell grid there is nothing for it to refuse.
  it("nextAttention still does not zoom a lone cell", () => {
    const lonely = make([cell(0, U(0)), cell(1)]);
    expect(nextAttention(lonely, [0, 1], { 0: "blocked" }, null).expanded).toBeNull();
  });

  it("always allows LEAVING the zoom, even in a state that could not be entered", () => {
    const lonely = make([cell(0, U(0))], { expanded: 0 });
    expect(toggleZoom(lonely, [0], 0).expanded).toBeNull();
    expect(toggleExpand(lonely, 0, [0]).expanded).toBeNull();
  });
});
