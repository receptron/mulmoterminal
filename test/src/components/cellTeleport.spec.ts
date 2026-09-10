// @vitest-environment node
// Where a cell's terminal is shown when it is not in its own tile (#2001).
import { describe, it, expect } from "vitest";
import { cellPlacement, teleportKey } from "../../../src/components/cellTeleport";

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

// A `<Teleport>` that changes target while it is DISABLED keeps the old one, and re-enabling it
// later moves the cell into a node that has since left the document — the terminal disappears from
// every view. Re-keying the collection trip gives it its own teleport (found by running it, #2002).
describe("teleportKey", () => {
  it("gives the collection pane its own teleport", () => {
    expect(teleportKey(3, "collection")).not.toBe(teleportKey(3, "tile"));
    expect(teleportKey(3, "collection")).not.toBe(teleportKey(3, "zoom"));
  });

  // Tile and zoom share one, so the grid's FLIP animation still measures and moves the same
  // elements it enlarges.
  it("keeps one teleport across tile and zoom", () => {
    expect(teleportKey(3, "zoom")).toBe(teleportKey(3, "tile"));
  });

  it("keeps two cells apart", () => {
    expect(teleportKey(1, "collection")).not.toBe(teleportKey(2, "collection"));
    expect(teleportKey(1, "tile")).not.toBe(teleportKey(2, "tile"));
  });
});
