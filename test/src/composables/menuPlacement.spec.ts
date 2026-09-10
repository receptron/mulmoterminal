// @vitest-environment node
import { describe, it, expect } from "vitest";
import { menuPlacement, MIN_MENU_HEIGHT_PX, MENU_VIEWPORT_GAP_PX } from "../../../src/composables/menuPlacement";

const VIEWPORT = 800;
// A cell's forum button is ~24px tall; the rect is the wrapper around it.
const trigger = (top: number, height = 24) => ({ top, bottom: top + height });

describe("menuPlacement", () => {
  it("opens downward with the space below when there is room", () => {
    const p = menuPlacement(trigger(100), VIEWPORT);
    expect(p.up).toBe(false);
    expect(p.maxHeightPx).toBe(VIEWPORT - 124 - MENU_VIEWPORT_GAP_PX);
  });

  // The case in #2003: a cell on the bottom row of a 20-cell grid. Downward there is a menu that
  // runs off the window however well the lists inside it scroll.
  it("flips upward when below is cramped and above is roomier", () => {
    const p = menuPlacement(trigger(700), VIEWPORT);
    expect(p.up).toBe(true);
    expect(p.maxHeightPx).toBe(700 - MENU_VIEWPORT_GAP_PX);
  });

  // A flip costs the user the mental model "menus open downward", so it has to buy something.
  it("stays downward when below is cramped but above is no better", () => {
    const p = menuPlacement(trigger(60), 300);
    expect(p.up).toBe(false);
  });

  // Codex round 1, P2: the old minimum (220) sat BELOW the menu's own non-scrollable chrome
  // (~216px of round-table controls before either list shows a row), so a trigger with 220-260px
  // under it stayed downward and the controls were clipped — the reported bug, at the very
  // positions the threshold existed to protect. Measured in a browser at 180/220px: Start's
  // bottom fell past the menu's.
  it("flips when the space below cannot hold the controls that never scroll", () => {
    const chromeOnlyBelow = 240; // fits the ~216px chrome and nothing else
    const trig = trigger(VIEWPORT - chromeOnlyBelow - MENU_VIEWPORT_GAP_PX - 24);
    expect(menuPlacement(trig, VIEWPORT).up).toBe(true);
  });

  it("does not flip for a few pixels — below has to be under the minimum", () => {
    const justEnough = VIEWPORT - MENU_VIEWPORT_GAP_PX - MIN_MENU_HEIGHT_PX - 24;
    expect(menuPlacement(trigger(justEnough), VIEWPORT).up).toBe(false);
    expect(menuPlacement(trigger(justEnough + 1), VIEWPORT).up).toBe(true);
  });

  // A negative max-height is dropped by CSS, which would leave the menu unbounded — the exact
  // shape of the bug this exists to prevent.
  it("never returns a negative height, whatever the rect says", () => {
    [trigger(2000), trigger(-500), trigger(800), { top: -100, bottom: -50 }].forEach((rect) => {
      expect(menuPlacement(rect, VIEWPORT).maxHeightPx).toBeGreaterThanOrEqual(0);
    });
  });

  it("handles a zero-height viewport without producing NaN", () => {
    const p = menuPlacement(trigger(0), 0);
    expect(Number.isFinite(p.maxHeightPx)).toBe(true);
    expect(p.maxHeightPx).toBeGreaterThanOrEqual(0);
  });
});
