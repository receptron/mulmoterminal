// @vitest-environment node
// Which cells the grid renders: the page, the whole list while zoomed, and the one the collection
// pane claimed wherever it sits (#2001).
import { describe, it, expect } from "vitest";
import { cellsToDisplay } from "../../../src/components/displayCells";

const cells = (count: number) => Array.from({ length: count }, (_, i) => ({ session: `s${i}` }));
const sessions = (rows: { session: string | null }[]) => rows.map((r) => r.session);

describe("cellsToDisplay", () => {
  const twelve = cells(12); // more than one page of nine

  it("shows one page while un-zoomed", () => {
    expect(cellsToDisplay(twelve, 0, false, null)).toHaveLength(9);
    expect(sessions(cellsToDisplay(twelve, 1, false, null))).toEqual(["s9", "s10", "s11"]);
  });

  it("shows everything while zoomed, page or no page", () => {
    expect(cellsToDisplay(twelve, 0, true, null)).toHaveLength(12);
  });

  // The claimed cell has to be rendered or there is nothing for the pane to teleport — and a chat
  // pushed onto another page would silently vanish from the collection it belongs to.
  it("adds a claimed cell from another page, without disturbing the page", () => {
    const shown = cellsToDisplay(twelve, 0, false, "s11");
    expect(shown).toHaveLength(10);
    expect(sessions(shown).slice(0, 9)).toEqual(sessions(twelve).slice(0, 9));
    expect(sessions(shown)).toContain("s11");
  });

  it("adds nothing when the claimed cell is already on the page", () => {
    expect(cellsToDisplay(twelve, 0, false, "s2")).toHaveLength(9);
  });

  // A claim for a session with no cell — it ended, or the grid was full when it started.
  it("adds nothing for a session the grid does not have", () => {
    expect(cellsToDisplay(twelve, 0, false, "gone")).toHaveLength(9);
    expect(cellsToDisplay(twelve, 0, false, undefined)).toHaveLength(9);
  });

  it("never hands back the array it was given", () => {
    expect(cellsToDisplay(twelve, 0, true, null)).not.toBe(twelve);
  });
});
