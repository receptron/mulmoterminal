import { describe, it, expect } from "vitest";

import { preferredLaunchDir, shouldSyncLaunchDir } from "../../../src/components/launchDir";

const preset = (path: string) => ({ path });

// Get either of these wrong and the user presses Enter and starts an agent in the wrong
// repository.
describe("preferredLaunchDir", () => {
  it("prefers the cell's own persisted directory", () => {
    expect(preferredLaunchDir({ initialCwd: "/work/mine", presets: [preset("/work/other")], defaultCwd: "/home" })).toBe("/work/mine");
  });

  it("falls back to the most recent preset", () => {
    expect(preferredLaunchDir({ presets: [preset("/work/recent"), preset("/work/older")], defaultCwd: "/home" })).toBe("/work/recent");
  });

  it("falls back to the server default when there are no presets", () => {
    expect(preferredLaunchDir({ presets: [], defaultCwd: "/home" })).toBe("/home");
  });

  it("offers an empty field when nothing is known", () => {
    expect(preferredLaunchDir({ presets: [] })).toBe("");
  });

  // Null is what an unset persisted dir looks like — it must fall through, not win.
  it("treats a null persisted dir as unset", () => {
    expect(preferredLaunchDir({ initialCwd: null, presets: [preset("/work/recent")] })).toBe("/work/recent");
  });
});

describe("shouldSyncLaunchDir", () => {
  const fresh = { hasInitialCwd: false, touched: false, launched: false };

  // The upgrade this exists for: a cell opened before /api/config landed starts blank.
  it("upgrades a pristine field when config finally arrives", () => {
    expect(shouldSyncLaunchDir(fresh)).toBe(true);
  });

  // The guard that matters most — config can land one keystroke before the user hits Go.
  it("never overwrites a directory the user typed", () => {
    expect(shouldSyncLaunchDir({ ...fresh, touched: true })).toBe(false);
  });

  it("leaves a restored cell's own directory alone", () => {
    expect(shouldSyncLaunchDir({ ...fresh, hasInitialCwd: true })).toBe(false);
  });

  it("does not touch a cell that already launched", () => {
    expect(shouldSyncLaunchDir({ ...fresh, launched: true })).toBe(false);
  });

  it("stays put when several reasons apply", () => {
    expect(shouldSyncLaunchDir({ hasInitialCwd: true, touched: true, launched: true })).toBe(false);
  });
});
