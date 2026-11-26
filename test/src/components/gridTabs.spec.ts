import { describe, it, expect } from "vitest";
import type { RunCommand } from "../../../src/components/runCommand.js";
import {
  unplacedCell,
  pageCount,
  pageSlice,
  resolveCellStatus,
  runningCount,
  setSession,
  setCwd,
  setCellAgent,
  setCellParked,
  closeCell,
  toggleExpand,
  switchPage,
  runCommand,
  runScriptInNewCell,
  insertCellAfter,
  MAX_TERMINALS,
  revealCell,
  jumpTo,
  shellCell,
  sessionCell,
  launchInCell,
  canMoveCell,
  canDropCellBefore,
  canMoveCellBefore,
  reorderBefore,
  setSortMode,
  moveCell,
  moveCellBefore,
  moveZoom,
  moveFocus,
  moveFocusUid,
  toggleZoom,
  nextAttention,
  nextAttentionUid,
  orderCells,
  visibleOrdered,
  countByStatus,
  zoomedUid,
  visibleCells,
  parseGridState,
  migrateLegacy,
  initialState,
  type GridState,
  type Cell,
  gridStatusSummary,
} from "../../../src/components/gridTabs.js";
import { gridStatusTitle, type GridStatusSummary } from "../../../src/components/gridTabs.js";
import { i18n } from "../../../src/i18n";

// The tooltip the toolbar shows, read through the real messages under the pinned English locale.
const titleOf = (summary: GridStatusSummary): string => gridStatusTitle(summary, i18n.global.t);
import type { AttentionStatus } from "../../../src/components/attentionStatus.js";

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

describe("moveFocus (walking the cursor across the tiled grid, #2106)", () => {
  const order3 = [0, 1, 2];

  it("steps the focus forward and back along the on-screen order", () => {
    expect(moveFocusUid(make(running(3)), order3, 1, 1)).toBe(2);
    expect(moveFocusUid(make(running(3)), order3, 1, -1)).toBe(0);
  });

  it("stops at either end instead of wrapping, as moveZoom does", () => {
    expect(moveFocusUid(make(running(3)), order3, 2, 1)).toBeNull();
    expect(moveFocusUid(make(running(3)), order3, 0, -1)).toBeNull();
  });

  it("lands on the first terminal of the current page when nothing is focused yet", () => {
    expect(moveFocusUid(make(running(3)), order3, null, 1)).toBe(0);
    // The page the user is LOOKING at, not index 0 of the whole list.
    const twoPages = make(running(12), { page: 1 });
    expect(moveFocusUid(twoPages, [...Array(12).keys()], null, 1)).toBe(9);
  });

  // A focused cell that has since closed is the same situation as never having had one: the
  // arithmetic must not read -1 as an index and jump to the front.
  it("treats a stale origin as no origin rather than stepping from index -1", () => {
    expect(moveFocusUid(make(running(3)), order3, 99, 1)).toBe(0);
  });

  it("skips the empty launch cell — focusing it would be a no-op, so the key would read as dead", () => {
    const withLauncher = make([cell(0, U(0)), cell(1), cell(2, U(2))]);
    expect(moveFocusUid(withLauncher, order3, 0, 1)).toBe(2);
    expect(moveFocusUid(withLauncher, order3, 2, -1)).toBe(0);
  });

  it("has nowhere to go on a grid that is only a launch cell", () => {
    expect(moveFocusUid(make([cell(0)]), [0], null, 1)).toBeNull();
  });

  it("refuses while a terminal is enlarged — that state belongs to moveZoom", () => {
    const s = make(running(3), { expanded: 1 });
    expect(moveFocusUid(s, order3, 1, 1)).toBeNull();
    expect(moveFocus(s, order3, 1, 1)).toBe(s);
  });

  it("brings the target's page on screen, so a step off the page edge is visible", () => {
    const order = [...Array(12).keys()];
    const after = moveFocus(make(running(12), { page: 0 }), order, 8, 1);
    expect(moveFocusUid(make(running(12), { page: 0 }), order, 8, 1)).toBe(9);
    expect(after.page).toBe(1);
  });

  it("never enters or leaves the zoom, and never touches the cells (INVARIANT 1)", () => {
    const before = make(running(12), { page: 0 });
    const after = moveFocus(before, [...Array(12).keys()], 0, 1);
    expect(after.expanded).toBeNull();
    expect(after.cells).toBe(before.cells);
  });

  it("returns the state untouched when there is nowhere to go", () => {
    const s = make(running(3));
    expect(moveFocus(s, order3, 2, 1)).toBe(s);
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

  // This used to be refused (#374). The zoomed row is where the Canvas / Tools / Files panes live,
  // so refusing it left them unreachable on a one-terminal grid — see toggleExpand.
  it("zooms with a single running cell (same rule as toggleExpand)", () => {
    const s = make([cell(0, U(0)), cell(1)]); // one running + one empty launcher
    expect(toggleZoom(s, [0, 1]).expanded).toBe(0);
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
  const status = (m: Record<number, AttentionStatus>): Record<number, AttentionStatus> => m;

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
  // ENLARGE while zoomed. `ensureEntry` means one is almost always present.
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

  // The reverse of what #374 pinned. Zooming is not only "one big, the rest as a filmstrip": the
  // zoomed row is also the only place the Canvas / Tools / Files panes exist, so refusing it left
  // them unreachable on a one-terminal grid — the unread-canvas chip did nothing when clicked, and
  // an agent's drawing had nowhere to be shown. Enlarging your one terminal is also just a thing to
  // want. Owner's call, after hitting it live.
  it("zooms the only occupied cell", () => {
    expect(toggleExpand(make([cell(0, U(0)), cell(1)]), 0).expanded).toBe(0);
  });

  it("zooms as soon as a second cell is occupied", () => {
    expect(toggleExpand(make([cell(0, U(0)), cell(1, U(1)), cell(2)]), 0).expanded).toBe(0);
  });

  // Also a reversal: a grid of nothing but launch cells zooms too. The launch form is what gets
  // enlarged, which is a bigger form rather than a broken state — and keeping the old refusal for
  // this one case would mean the expand button worked on some cells and silently not on others.
  it("zooms a launch cell", () => {
    expect(toggleExpand(make([cell(0), cell(1)]), 0).expanded).toBe(0);
  });

  // A uid no cell holds would be stored and then read back as "not zoomed" by zoomedUid — the
  // grid is never zoomed at nothing, it simply stays as it was.
  it("ignores a uid no cell has", () => {
    const s = make(running(2));
    expect(toggleExpand(s, 99)).toBe(s);
  });

  // Whatever a state got into, the collapse button has to get out of it — including a state
  // that was zoomed when its sibling closed.
  it("always allows collapsing, even down to one cell", () => {
    const stranded = make([cell(0, U(0)), cell(1)], { expanded: 0 });
    expect(toggleExpand(stranded, 0).expanded).toBeNull();
  });
});

// What starts a cell is MOUNTING, and a cell mounts only on the page the grid shows — so for an
// auto-start cell the page is not cosmetic. insertCellAfter can only page by the manual index.
describe("revealCell (page at where the cell is actually shown)", () => {
  const ten = () => make(running(10), { page: 1 });

  it("pages at the cell's position in the DISPLAY order, not its manual one", () => {
    const manualLast = ten();
    const reordered = [9, ...Array.from({ length: 9 }, (_, i) => i)]; // uid 9 sorted to the front
    expect(revealCell(manualLast, 9, reordered).page).toBe(0);
  });

  it("agrees with the manual page when nothing was re-ordered", () => {
    const order = Array.from({ length: 10 }, (_, i) => i);
    expect(revealCell(ten(), 9, order).page).toBe(1);
  });

  // A uid the order doesn't carry (a full grid refused the insert) must not move the user.
  it("leaves the page alone for a uid the order does not hold", () => {
    expect(revealCell(ten(), 99, [0, 1, 2]).page).toBe(1);
  });
});

// The palette's jump to a named terminal (#2446): what `next-attention` does with its pick.
describe("jumpTo", () => {
  const order = Array.from({ length: 10 }, (_, i) => i);

  it("makes the terminal the enlarged one when one is enlarged", () => {
    const zoomed = make(running(10), { expanded: 2 });
    expect(jumpTo(zoomed, 7, order).expanded).toBe(7);
  });

  it("changes nothing for a uid no cell holds, enlarged or not", () => {
    const zoomed = make(running(10), { expanded: 2 });
    expect(jumpTo(zoomed, 99, order)).toBe(zoomed);
    const tiled = make(running(10), { page: 1 });
    expect(jumpTo(tiled, 99, order)).toBe(tiled);
  });

  it("brings the terminal's page on screen and leaves the grid a grid otherwise", () => {
    const tiled = make(running(10), { page: 0 });
    const jumped = jumpTo(tiled, 9, order);
    expect(jumped.page).toBe(1);
    expect(jumped.expanded).toBeNull();
  });
});

// `autoStart` is a cell the grid already knows what to run — the phone's launch request (#831).
// Between the request and the server's session id it is the only thing telling the rest of the
// grid that this cell is not an abandoned launcher, which is what #1535 turned on.
describe("autoStart (a cell told to run on mount)", () => {
  const starting = (uid: number): Cell => ({ uid, session: null, cwd: "/w", autoStart: true });

  it("counts toward the cap like any other running cell", () => {
    expect(runningCount([cell(0, U(0)), starting(1), cell(2)])).toBe(2);
  });

  // The one that costs the terminal: flipping pages before the session id lands would otherwise
  // delete the cell the phone just asked for, as an abandoned trailing launcher.
  it("survives a page switch", () => {
    expect(switchPage(make([...running(9), starting(9)], { page: 1 }), 0).cells).toHaveLength(10);
  });

  // One-shot: the cell has answered. Left set, closing that session later would leave an empty
  // launcher permanently counted as occupied.
  it("is cleared once the session arrives", () => {
    const s = setSession(make([starting(0)]), 0, U(5));
    expect(s.cells[0].session).toBe(U(5));
    expect(s.cells[0].autoStart).toBeUndefined();
    expect("autoStart" in s.cells[0]).toBe(false); // absent, not undefined — it round-trips through JSON
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

// Parking is a display state the user sets (#992), so it has to survive a reload — and
// `parseGridState` rebuilds every cell from a fixed field list, where a key nobody named is
// dropped silently with nothing to typecheck against. Same absent-means-off round-trip rule as
// `agent` above.
describe("setCellParked", () => {
  it("parks the matching cell and leaves the others alone", () => {
    const s = setCellParked(make([cell(0, U(0)), cell(1, U(1))]), 0, true);
    expect(s.cells[0].parked).toBe(true);
    expect(Object.hasOwn(s.cells[1], "parked")).toBe(false);
  });

  it("drops the key when waking, rather than setting it false", () => {
    const parked = setCellParked(make([cell(0, U(0))]), 0, true);
    expect(Object.hasOwn(setCellParked(parked, 0, false).cells[0], "parked")).toBe(false);
  });

  it("keeps the rest of the cell intact", () => {
    expect(setCellParked(make([cell(0, U(0), "/repo")]), 0, true).cells[0]).toMatchObject({ uid: 0, session: U(0), cwd: "/repo" });
  });

  it("survives parseGridState, so a reload does not silently wake every parked cell", () => {
    const s = setCellParked(make([cell(0, U(0), "/repo"), cell(1, U(1), "/other")]), 0, true);
    const cells = parseGridState(JSON.stringify(s))?.cells ?? [];
    expect(cells.map((c) => Object.hasOwn(c, "parked"))).toEqual([true, false]);
    expect(cells[0]?.parked).toBe(true);
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
  // #3506: the launch form that offered the script is this machine's, so it runs here.
  it("runs on this machine even in a cell that was on a remote host", () => {
    const s = runCommand(make([{ ...cell(0), remoteHost: "lx" }]), 0, CMD);
    expect(s.cells[0].command).toEqual(CMD);
    expect("remoteHost" in s.cells[0]).toBe(false);
  });
  it("runs a running cell's script on that cell's host, and here for a local one", () => {
    const remote = runScriptInNewCell(make([{ ...cell(0, U(0)), remoteHost: "lx" }]), 0, CMD);
    expect(remote.cells[1]).toMatchObject({ command: CMD, remoteHost: "lx" });
    const local = runScriptInNewCell(make([cell(0, U(0))]), 0, CMD);
    expect("remoteHost" in (local.cells[1] ?? {})).toBe(false);
    const noOrigin = runScriptInNewCell(make([{ ...cell(0, U(0)), remoteHost: "lx" }]), -1, CMD);
    expect("remoteHost" in (noOrigin.cells[1] ?? {})).toBe(false);
  });
  it("switchPage keeps a trailing command cell (only abandons an empty launcher)", () => {
    const after = switchPage(make([...running(9), cmdCell(9)], { page: 1 }), 0);
    expect(after.cells).toHaveLength(10);
  });
});

// #1867: a wrapper names one command line for ONE agent, so relaunching the cell as something else
// has to drop it. Left behind it wins over `agent` when the cell reseeds its picker after a reload,
// which reconnects a live codex session on Claude's endpoint.
// The cap rule every launch path now leans on: `placeCell` in GridView asks it before it inserts,
// because `insertCellAfter` returning the state UNCHANGED is otherwise indistinguishable from a
// successful placement — and a caller that assumes success closes the launch form over a terminal
// that was never created (codex [P1], #1890).
describe("insertCellAfter and the terminal cap", () => {
  it("refuses to insert once MAX_TERMINALS are running, leaving the state alone", () => {
    const full = make(running(MAX_TERMINALS));
    const after = insertCellAfter(full, 0, { session: null, cwd: "/p", autoStart: true });
    expect(after.cells).toHaveLength(MAX_TERMINALS);
    expect(runningCount(after.cells)).toBe(MAX_TERMINALS);
    expect(after.nextUid).toBe(full.nextUid); // nothing was minted either
  });

  it("still inserts one below the cap", () => {
    const after = insertCellAfter(make(running(MAX_TERMINALS - 1)), 0, { session: null, cwd: "/p", autoStart: true });
    expect(after.cells).toHaveLength(MAX_TERMINALS);
  });
});

describe("setCellAgent and the custom-agent wrapper", () => {
  const withWrapper = () => make([{ uid: 0, session: null, cwd: "/p", customAgent: "kimi_k3", autoStart: true }]);

  // The distinction the caller has to make. A custom pick reports `agent: "claude"` WITH its
  // wrapper; a plain claude launch reports the same agent with none. An earlier fix cleared on the
  // agent alone, which could not tell them apart — and so cleared the wrapper on the very launch
  // that was using it (codex + CodeRabbit, #1890).
  it("keeps the wrapper when the launch reports one", () => {
    const s = setCellAgent(withWrapper(), 0, "claude", "kimi_k3");
    expect(s.cells[0].customAgent).toBe("kimi_k3");
    expect("agent" in s.cells[0]).toBe(false); // a wrapper still runs Claude Code
  });

  it("drops it when the launch reports none — the user switched away", () => {
    const s = setCellAgent(withWrapper(), 0, "codex");
    expect(s.cells[0].agent).toBe("codex");
    expect(s.cells[0].customAgent).toBeUndefined();
  });

  it("drops it going back to plain claude too, where the agent key is absent either way", () => {
    const s = setCellAgent(withWrapper(), 0, "claude");
    expect("agent" in s.cells[0]).toBe(false);
    expect(s.cells[0].customAgent).toBeUndefined();
  });

  // Persisted cells round-trip through JSON, so a dropped key has to be genuinely gone rather than
  // present-and-undefined — and a kept one has to survive.
  it("round-trips both answers through parseGridState", () => {
    const dropped = setSession(setCellAgent(withWrapper(), 0, "codex"), 0, U(5));
    expect(parseGridState(JSON.stringify(dropped))?.cells[0].customAgent).toBeUndefined();
    const kept = setSession(setCellAgent(withWrapper(), 0, "claude", "kimi_k3"), 0, U(6));
    expect(parseGridState(JSON.stringify(kept))?.cells[0].customAgent).toBe("kimi_k3");
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
  it("counts a launcher cell as running (an empty launch cell does not)", () => {
    const withLauncher = launchInCell(make([cell(0), cell(1)]), 0, L, "/p");
    expect(runningCount(withLauncher.cells)).toBe(1);
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

describe("sessionCell (adopting a session spawned elsewhere)", () => {
  it("carries a non-Claude agent, so the cell reconnects on that agent's endpoint", () => {
    expect(sessionCell("s1", "/proj", "codex")).toEqual({ session: "s1", cwd: "/proj", agent: "codex" });
    expect(sessionCell("s2", "/proj", "antigravity")).toEqual({ session: "s2", cwd: "/proj", agent: "antigravity" });
  });

  // `toEqual` treats an explicit `agent: undefined` as equal to an absent key, so the invariant has
  // to be asserted on the KEY. It matters: a persisted cell round-trips through JSON, where
  // `undefined` disappears — but exactOptionalPropertyTypes also rejects it at the type level, and
  // both would be satisfied by a shape that reads fine and is wrong.
  it("writes no agent key at all for Claude, rather than an undefined one", () => {
    const cell = sessionCell("s3", "/proj", "claude");
    expect(cell).toEqual({ session: "s3", cwd: "/proj" });
    expect("agent" in cell).toBe(false);
  });

  it("accepts a null cwd — the config may not have loaded when a session is adopted", () => {
    expect(sessionCell("s4", null, "claude")).toEqual({ session: "s4", cwd: null });
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

  // The roster's drag handle (#2126) drops a row at an arbitrary slot, which a neighbour swap
  // cannot express. Destination = "in front of this uid", null = the end of the list.
  it("moveCellBefore lifts a cell out and puts it back in front of the named one", () => {
    const s = make(running(4));
    expect(moveCellBefore(s, 3, 0).cells.map((c) => c.uid)).toEqual([3, 0, 1, 2]); // last to the top
    expect(moveCellBefore(s, 0, 3).cells.map((c) => c.uid)).toEqual([1, 2, 0, 3]); // first down two
    expect(moveCellBefore(s, 1, null).cells.map((c) => c.uid)).toEqual([0, 2, 3, 1]); // null = the end
  });

  it("moveCellBefore is a no-op wherever the order would not change", () => {
    const s = make(running(3));
    expect(moveCellBefore(s, 1, 1)).toBe(s); // in front of itself
    expect(moveCellBefore(s, 0, 1)).toBe(s); // in front of its own successor is where it already is
    expect(moveCellBefore(s, 2, null)).toBe(s); // already last
    expect(moveCellBefore(s, 99, 0)).toBe(s); // unknown cell
    expect(moveCellBefore(s, 0, 99)).toBe(s); // unknown destination
  });

  it("moveCellBefore won't drop a cell past the trailing launch cell, but will move the launcher itself", () => {
    const s = make([...running(2), cell(2)]); // cell 2 is the trailing launcher
    expect(moveCellBefore(s, 0, null)).toBe(s); // the end of the list is the launcher's slot
    expect(moveCellBefore(s, 0, 2).cells.map((c) => c.uid)).toEqual([1, 0, 2]); // in front of it is fine
    expect(moveCellBefore(s, 2, 0).cells.map((c) => c.uid)).toEqual([2, 0, 1]); // the launcher may leave last
  });

  // Same contract canMoveCell has with moveCell: it gates the drop indicator, so it must report
  // exactly the moves moveCellBefore would perform.
  it("canMoveCellBefore reports exactly what moveCellBefore would change", () => {
    const cells = [...running(2), cell(2)];
    expect(canMoveCellBefore(cells, 0, 2)).toBe(true);
    expect(canMoveCellBefore(cells, 2, 0)).toBe(true);
    expect(canMoveCellBefore(cells, 0, null)).toBe(false); // past the trailing launcher
    expect(canMoveCellBefore(cells, 0, 1)).toBe(false); // no-op
    expect(canMoveCellBefore(cells, 0, 0)).toBe(false); // in front of itself
    expect(canMoveCellBefore(cells, 99, 0)).toBe(false); // unknown cell
    expect(canMoveCellBefore(cells, 0, 99)).toBe(false); // unknown destination
    // No trailing launcher: the end of the list becomes a destination.
    expect(canMoveCellBefore(running(3), 0, null)).toBe(true);
  });

  // The roster's drag PREVIEW asks this one instead: hovering the slot a row started in is a legal
  // thing to do mid-drag (the rows have to show it back in place), it just commits nothing.
  it("canDropCellBefore allows the no-op slots canMoveCellBefore refuses, and nothing else", () => {
    const cells = [...running(2), cell(2)]; // cell 2 is the trailing launcher
    expect(canDropCellBefore(cells, 0, 1)).toBe(true); // where it already is — legal to hover
    expect(canMoveCellBefore(cells, 0, 1)).toBe(false); // ...and commits nothing
    expect(canDropCellBefore(cells, 0, null)).toBe(false); // past the trailing launcher: never
    expect(canDropCellBefore(cells, 0, 0)).toBe(false); // in front of itself is not a slot
    expect(canDropCellBefore(cells, 99, 0)).toBe(false); // unknown cell
    expect(canDropCellBefore(cells, 0, 99)).toBe(false); // unknown destination
  });

  // The preview renders this over the ROWS while moveCellBefore applies it to the CELLS, so the
  // list you see mid-drag cannot describe a move the drop does not make.
  it("reorderBefore is the order moveCellBefore produces, on any keyed list", () => {
    const items = [{ uid: 0 }, { uid: 1 }, { uid: 2 }, { uid: 3 }];
    expect(reorderBefore(items, 3, 0).map((i) => i.uid)).toEqual([3, 0, 1, 2]);
    expect(reorderBefore(items, 0, 3).map((i) => i.uid)).toEqual([1, 2, 0, 3]);
    expect(reorderBefore(items, 1, null).map((i) => i.uid)).toEqual([0, 2, 3, 1]);
    expect(reorderBefore(items, 0, 1).map((i) => i.uid)).toEqual([0, 1, 2, 3]); // already there
    expect(reorderBefore(items, 99, 0).map((i) => i.uid)).toEqual([0, 1, 2, 3]); // unknown cell
    expect(reorderBefore(items, 0, 99).map((i) => i.uid)).toEqual([0, 1, 2, 3]); // unknown destination
    expect(reorderBefore(items, 0, 3)).not.toBe(items); // never mutates its input
    // The pairing the preview rests on: same order, whichever of the two produced it.
    const s = make(running(4));
    expect(moveCellBefore(s, 3, 0).cells.map((c) => c.uid)).toEqual(reorderBefore(s.cells, 3, 0).map((c) => c.uid));
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
  const status = (m: Record<number, AttentionStatus>) => m;
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
    const statusByUid: Record<number, AttentionStatus> = { 0: "working", 1: "blocked", 10: "blocked" };
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
    const out = resolveCellStatus([cell(1, "s1")], new Map<string, AttentionStatus>([["s1", "blocked"]]), { 1: "working" });
    expect(out[1]).toBe("blocked");
  });

  // Command cells have no session id, and a just-launched cell has none yet — without the
  // fallback they would read idle and sort past cells that need nothing.
  it("falls back to the cell's own status when it has no session", () => {
    expect(resolveCellStatus([cell(2, null)], new Map<string, AttentionStatus>(), { 2: "working" })[2]).toBe("working");
  });

  it("falls back when the session has no activity yet", () => {
    expect(resolveCellStatus([cell(3, "unknown")], new Map<string, AttentionStatus>(), { 3: "working" })[3]).toBe("working");
  });

  it("lands on idle when nothing knows anything", () => {
    expect(resolveCellStatus([cell(4, null)], new Map<string, AttentionStatus>(), {})[4]).toBe("idle");
  });

  it("answers for every cell, not just the ones with activity", () => {
    const out = resolveCellStatus([cell(1, "s1"), cell(2, null), cell(3, "s3")], new Map<string, AttentionStatus>([["s1", "blocked"]]), {});
    expect(Object.keys(out).sort()).toEqual(["1", "2", "3"]);
  });

  it("keys by uid, so two cells on the same session can still differ elsewhere", () => {
    const out = resolveCellStatus([cell(1, "s1"), cell(2, "s1")], new Map<string, AttentionStatus>([["s1", "working"]]), {});
    expect([out[1], out[2]]).toEqual(["working", "working"]);
  });

  it("returns an empty map for no cells", () => {
    expect(resolveCellStatus([], new Map<string, AttentionStatus>(), {})).toEqual({});
  });
});

describe("gridStatusSummary", () => {
  const counts = (over: Partial<Record<"blocked" | "done" | "working" | "idle", number>> = {}) => ({ blocked: 0, done: 0, working: 0, idle: 0, ...over });

  it("shows nothing when there are no counts", () => {
    expect(gridStatusSummary(null)).toEqual({ show: false, parts: [] });
    expect(gridStatusSummary(undefined)).toEqual({ show: false, parts: [] });
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
    expect(titleOf(s)).toBe("1 working · 3 idle");
  });

  // Reading order: blocked (needs you) first.
  it("orders the parts blocked, done, working, idle", () => {
    expect(titleOf(gridStatusSummary(counts({ blocked: 1, done: 2, working: 3, idle: 4 })))).toBe("1 need input · 2 done (review) · 3 working · 4 idle");
  });

  it("omits a zero count from the title", () => {
    expect(titleOf(gridStatusSummary(counts({ blocked: 2, working: 1 })))).toBe("2 need input · 1 working");
  });
});

// The rules written at the top of the zoom section in gridTabs.ts. Each was broken at least
// once while building #829, so they are pinned as rules rather than as one-off cases: a future
// action that quietly violates one fails here instead of in someone's grid.
describe("zoom invariants (#829)", () => {
  const order12 = Array.from({ length: 12 }, (_, i) => i);
  const allIdle: Record<number, AttentionStatus> = {};

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

  // Invariant 5 — entry is refused for nothing that exists, and leaving never refuses either. The
  // second-running-cell requirement is gone (#374 reversed): the zoomed row is the only place the
  // Canvas / Tools / Files panes exist, so it locked them away on a one-terminal grid.
  it("ENTERS the zoom with one running cell", () => {
    const lonely = make([cell(0, U(0)), cell(1)]); // one running + an empty launcher
    expect(toggleZoom(lonely, [0, 1], 0).expanded).toBe(0);
  });

  // Unchanged by that, and for a different reason: by invariant 1, nextAttention never ENTERS the
  // zoom at all — it relocates an existing one — so a tiled grid stays tiled however few cells it
  // has.
  it("nextAttention still does not zoom a lone cell", () => {
    const lonely = make([cell(0, U(0)), cell(1)]);
    expect(nextAttention(lonely, [0, 1], { 0: "blocked" }, null).expanded).toBeNull();
  });

  it("always allows LEAVING the zoom", () => {
    const lonely = make([cell(0, U(0))], { expanded: 0 });
    expect(toggleZoom(lonely, [0], 0).expanded).toBeNull();
    expect(toggleExpand(lonely, 0, [0]).expanded).toBeNull();
  });
});

describe("setCellAgent and the account (#2215)", () => {
  const launched = () => make([{ uid: 0, session: null, cwd: "/p", account: "work", autoStart: true }]);

  it("keeps the account the launch reports", () => {
    expect(setCellAgent(launched(), 0, "claude", null, "work").cells[0].account).toBe("work");
  });

  it("drops it when the launch reports the default login, rather than labelling the new session", () => {
    expect("account" in setCellAgent(launched(), 0, "claude").cells[0]).toBe(false);
    expect("account" in setCellAgent(launched(), 0, "codex", null, null).cells[0]).toBe(false);
  });

  it("round-trips a valid account through parseGridState and drops a malformed one", () => {
    const kept = setSession(setCellAgent(launched(), 0, "claude", null, "work"), 0, U(7));
    expect(parseGridState(JSON.stringify(kept))?.cells[0].account).toBe("work");
    const stored = JSON.parse(JSON.stringify(kept));
    stored.cells[0].account = "Not An Id";
    expect("account" in (parseGridState(JSON.stringify(stored))?.cells[0] ?? {})).toBe(false);
  });
});

// A row of /api/sessions/unplaced as the cell that adopts it. A bot job's shell must come back as a
// Shell cell: read as an agent it falls to Claude, and the grid would start Claude in its place.
describe("unplacedCell", () => {
  it("adopts a shell as a Shell cell on its session", () => {
    expect(unplacedCell("s1", "/jobs/s1", "shell")).toEqual({ session: "s1", cwd: "/jobs/s1", launcher: { shell: true, label: "shell" } });
  });

  it("adopts an agent as that agent, and an unknown kind as Claude", () => {
    expect(unplacedCell("s1", "/w", "codex")).toEqual({ session: "s1", cwd: "/w", agent: "codex" });
    expect(unplacedCell("s1", "/w", "claude")).toEqual({ session: "s1", cwd: "/w" });
    expect(unplacedCell("s1", "/w", undefined)).toEqual({ session: "s1", cwd: "/w" });
  });
});
