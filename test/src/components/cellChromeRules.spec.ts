import { describe, it, expect } from "vitest";

import { flipTargetUid, shouldFlipZoom, worktreeFailureMessage } from "../../../src/components/cellChromeRules";

describe("worktreeFailureMessage", () => {
  it.each([
    ["not-worktree", "Not a worktree"],
    ["no-branch", "No branch to push"],
    ["push-failed", "Push failed"],
  ])("explains %s", (reason, expected) => {
    expect(worktreeFailureMessage(reason)).toBe(expected);
  });

  // The push half succeeded — the message has to say so, or the user re-pushes.
  it("tells the user their push landed even though the PR did not", () => {
    expect(worktreeFailureMessage("no-github")).toContain("push succeeded");
  });

  it.each([[undefined], [null], [""], ["something-new"]])("falls back to a plain failure for %j", (reason) => {
    expect(worktreeFailureMessage(reason)).toBe("Failed");
  });

  // A reason arrives inside a server response, so a plain object literal would answer these
  // through its prototype chain — and `??` does not catch a function, so the UI would render
  // "function Object() { [native code] }" where a sentence belongs.
  it.each([["constructor"], ["toString"], ["__proto__"], ["hasOwnProperty"]])("does not resolve %s through the prototype chain", (reason) => {
    expect(worktreeFailureMessage(reason)).toBe("Failed");
  });
});

describe("flipTargetUid", () => {
  it("flies the cell being zoomed in", () => {
    expect(flipTargetUid(3, null)).toBe(3);
  });

  it("flies the cell being zoomed out", () => {
    expect(flipTargetUid(null, 3)).toBe(3);
  });

  it("has nothing to fly when neither end names a cell", () => {
    expect(flipTargetUid(null, null)).toBeNull();
    expect(flipTargetUid(undefined, undefined)).toBeNull();
  });

  // uid 0 is a real cell, and `??` is what keeps it from being read as "none".
  it("treats cell 0 as a cell", () => {
    expect(flipTargetUid(0, null)).toBe(0);
    expect(flipTargetUid(null, 0)).toBe(0);
  });
});

describe("shouldFlipZoom", () => {
  it("animates a zoom in and a zoom out", () => {
    expect(shouldFlipZoom(3, null, false)).toBe(true);
    expect(shouldFlipZoom(null, 3, false)).toBe(true);
  });

  // Swapping between two already-zoomed cells has no on-screen source to fly from — the
  // incoming cell sits off-screen in the grid — so the animation would start from nowhere.
  it("skips a swap between two zoomed cells", () => {
    expect(shouldFlipZoom(4, 3, false)).toBe(false);
  });

  it("respects a reduced-motion preference", () => {
    expect(shouldFlipZoom(3, null, true)).toBe(false);
  });

  it("does nothing when there is no cell at either end", () => {
    expect(shouldFlipZoom(null, null, false)).toBe(false);
  });
});
