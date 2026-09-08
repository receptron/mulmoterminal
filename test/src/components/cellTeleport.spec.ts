// @vitest-environment node
// Where a cell's terminal is shown when it is not in its own tile (#2001).
import { describe, it, expect } from "vitest";
import { cellPlacement } from "../../../src/components/cellTeleport";

const placement = (claimedByCollection: boolean, zoomed: boolean, expanded: boolean) => cellPlacement({ claimedByCollection, zoomed, expanded });

describe("cellPlacement", () => {
  it("leaves an ordinary cell in its tile", () => {
    expect(placement(false, false, false)).toBe("tile");
    expect(placement(false, true, false)).toBe("tile"); // zoomed grid, but this is not the enlarged one
    expect(placement(false, false, true)).toBe("tile"); // the expanded uid means nothing while un-zoomed
  });

  it("moves the enlarged cell into the zoom area", () => {
    expect(placement(false, true, true)).toBe("zoom");
  });

  // The pane is an overlay ON TOP of the grid, so a zoom underneath it is not what anyone is
  // looking at. Whatever the grid was doing, the collection asked for this terminal.
  it("gives the collection pane the cell it claimed, zoom or no zoom", () => {
    expect(placement(true, false, false)).toBe("collection");
    expect(placement(true, true, true)).toBe("collection");
  });
});
