import { describe, it, expect } from "vitest";
import { swallowsMouseTracking } from "../../../src/composables/mouseTrackingModes";

// The rule decides whether a `CSI ? Pm h/l` is dropped. Getting it wrong is quiet in both
// directions: too narrow and a drag types coordinates into the agent's prompt again (#729), too
// broad and an unrelated mode in the same sequence (cursor visibility, alt screen) is lost.
describe("swallowsMouseTracking", () => {
  it.each([1000, 1001, 1002, 1003])("drops tracking mode %i", (mode) => {
    expect(swallowsMouseTracking([mode])).toBe(true);
  });

  // Meaningless on their own, but they ride along in combined sequences — see the next case.
  it.each([1005, 1006, 1015, 1016])("drops encoding mode %i", (mode) => {
    expect(swallowsMouseTracking([mode])).toBe(true);
  });

  it("drops a combined tracking + encoding sequence (CSI ? 1002 ; 1006 h)", () => {
    expect(swallowsMouseTracking([1002, 1006])).toBe(true);
  });

  it.each([
    [25, "cursor visibility"],
    [2004, "bracketed paste"],
    [1049, "alternate screen"],
    [7, "auto-wrap"],
    [1, "cursor keys"],
  ])("passes unrelated mode %i (%s) through", (mode) => {
    expect(swallowsMouseTracking([mode])).toBe(false);
  });

  // The one that would break other behaviour: dropping the whole sequence would also drop the
  // cursor-visibility change riding in it, so tracking is honoured instead — the lesser harm.
  it("passes a sequence that mixes a mouse mode with an unrelated one", () => {
    expect(swallowsMouseTracking([25, 1002])).toBe(false);
    expect(swallowsMouseTracking([1002, 25])).toBe(false);
  });

  it("passes a parameterless sequence, which sets nothing", () => {
    expect(swallowsMouseTracking([])).toBe(false);
  });

  // Parameters may carry colon-separated sub-parameters; the mode is the first value.
  it("reads the mode from a sub-parameter group", () => {
    expect(swallowsMouseTracking([[1002, 5]])).toBe(true);
    expect(swallowsMouseTracking([[25, 5]])).toBe(false);
  });

  it("passes an empty sub-parameter group rather than assuming a mode", () => {
    expect(swallowsMouseTracking([[]])).toBe(false);
  });

  // 999/1004 sit either side of the tracking block (1004 is focus reporting, not mouse) — the
  // boundaries are where an off-by-one would hide.
  it.each([999, 1004, 1007, 1017])("passes neighbouring mode %i that is not mouse tracking", (mode) => {
    expect(swallowsMouseTracking([mode])).toBe(false);
  });
});
