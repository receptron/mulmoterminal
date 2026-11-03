import { describe, it, expect } from "vitest";
import { paneCanShowClick, paneToOpenBeside, type PaneClickState, type TiledClickState } from "../../../src/components/paneClickTarget";

// #910. The grid's half of "can this clicked path open in the pane" — the half that is about
// the grid's own state rather than the path. A wrong `false` just leaves the click on its old
// route; a wrong `true` opens the file against the wrong directory, so the cases below are
// the ones where two directories are in play at once.
describe("paneCanShowClick", () => {
  const CWD = "/Users/me/proj";
  const state = (over: Partial<PaneClickState> = {}): PaneClickState => ({ roomForPane: true, paneCellCwd: CWD, paneCwd: CWD, ...over });

  it("takes a click from the enlarged cell", () => {
    expect(paneCanShowClick(state(), CWD)).toBe(true);
  });

  // First click with the pane closed: it has never rooted anywhere, and is about to root on
  // the enlarged cell. Requiring paneCwd to match here would make the pane unreachable until
  // the user opened it by hand first — which is the whole point of this entrance.
  it("takes the first click, before the pane has ever opened", () => {
    expect(paneCanShowClick(state({ paneCwd: null }), CWD)).toBe(true);
  });

  // Nothing enlarged and no pane beside the tiles: a click must not open one there (#3027).
  it("declines when there is no room for the pane on screen", () => {
    expect(paneCanShowClick(state({ roomForPane: false }), CWD)).toBe(false);
    expect(paneCanShowClick(state({ roomForPane: false, paneCwd: null }), CWD)).toBe(false);
  });

  // Every cell stays mounted while one is enlarged (the filmstrip), so a thumbnail can be
  // clicked. Its path has nothing to do with the pane beside the enlarged cell.
  it("declines a click from a cell that is not the enlarged one", () => {
    expect(paneCanShowClick(state(), "/Users/me/other")).toBe(false);
  });

  // The pane stays behind when a re-root could not be saved out of. Its tree is still on the
  // previous cell's directory, so a path relative to the enlarged one resolves elsewhere.
  it("declines while the pane trails the zoom on another directory", () => {
    expect(paneCanShowClick(state({ paneCwd: "/Users/me/other" }), CWD)).toBe(false);
  });

  it("declines when the pane's cell has not reported a directory yet", () => {
    expect(paneCanShowClick(state({ paneCellCwd: null }), CWD)).toBe(false);
  });
});

// #3238. The tiled grid's half: a click may OPEN the pane beside its own cell, the way that cell's menu
// would. A wrong null leaves the click on its old route; a wrong uid opens the pane on another cell
// or roots it on a directory the path was not read against.
describe("paneToOpenBeside", () => {
  const CWD = "/Users/me/proj";
  const from = { uid: 7, cwd: CWD };
  const state = (over: Partial<TiledClickState> = {}): TiledClickState => ({ zoomed: false, fileLinkOpensPane: true, ...over });

  it("names the clicked cell on the tiled grid", () => {
    expect(paneToOpenBeside(state(), from, CWD)).toBe(7);
  });

  // Beside an enlarged cell the pane is the click's first stop already (paneCanShowClick), and a
  // thumbnail's click must not move it.
  it("is null while a cell is enlarged", () => {
    expect(paneToOpenBeside(state({ zoomed: true }), from, CWD)).toBeNull();
  });

  it("is null when the setting keeps the click on its old route", () => {
    expect(paneToOpenBeside(state({ fileLinkOpensPane: false }), from, CWD)).toBeNull();
  });

  it("is null for a click from a cell this grid does not have", () => {
    expect(paneToOpenBeside(state(), undefined, CWD)).toBeNull();
  });

  // The session reports a new directory before the cell does: a path read against the new one would
  // be opened against the old root.
  it("is null while the cell's directory is not the one the path was read against", () => {
    expect(paneToOpenBeside(state(), { uid: 7, cwd: "/Users/me/other" }, CWD)).toBeNull();
    expect(paneToOpenBeside(state(), { uid: 7, cwd: null }, CWD)).toBeNull();
  });
});
