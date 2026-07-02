import { describe, it, expect } from "vitest";
import {
  pageCount,
  pageSlice,
  runningCount,
  addCell,
  setSession,
  setCwd,
  closeCell,
  toggleExpand,
  switchPage,
  runCommand,
  runScriptInNewCell,
  setSortMode,
  moveCell,
  orderCells,
  visibleOrdered,
  activityStatus,
  cancelableLaunchUid,
  zoomedUid,
  visibleCells,
  parseGridState,
  migrateLegacy,
  initialState,
  type CellStatus,
  type GridState,
  type Cell,
} from "./gridTabs";

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
});

describe("cancelableLaunchUid", () => {
  const CMD = { index: 0, label: "Build", cwd: "/x" };
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
  it("un-zooms when the zoomed cell is closed", () => {
    const after = closeCell(make(running(2), { expanded: 0 }), 0);
    expect(after.expanded).toBeNull();
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
  const CMD = { index: 0, label: "Build", cwd: "/x" };
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

describe("runScriptInNewCell (toolbar Run menu)", () => {
  const CMD = { index: 1, label: "Dev server", cwd: "/x" };

  it("appends a new command cell and jumps to its page when all cells are occupied", () => {
    const s = runScriptInNewCell(make(running(2)), CMD);
    expect(s.cells).toHaveLength(3);
    expect(s.cells[2]).toMatchObject({ session: null, command: CMD });
    expect(s.page).toBe(0); // 3 cells -> still page 1
  });
  it("overflows onto a new page when the current page is full", () => {
    const s = runScriptInNewCell(make(running(9)), CMD);
    expect(s.cells).toHaveLength(10);
    expect(s.page).toBe(1); // jumped to the new cell's page
  });
  it("reuses a trailing empty launcher instead of appending", () => {
    const s = runScriptInNewCell(make([...running(2), cell(2)]), CMD); // trailing launch cell
    expect(s.cells).toHaveLength(3);
    expect(s.cells[2].command).toEqual(CMD);
  });
  it("turns the sole entry launch cell into a command cell", () => {
    const s = runScriptInNewCell(make([cell(0)]), CMD);
    expect(s.cells).toHaveLength(1);
    expect(s.cells[0].command).toEqual(CMD);
  });
  it("is a no-op at the terminal cap (no trailing launcher to reuse)", () => {
    const s = runScriptInNewCell(make(running(81)), CMD);
    expect(s.cells).toHaveLength(81);
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
