import { describe, it, expect } from "vitest";

import { badgeStyleFor } from "../../../src/components/dirBadge";

// The badge is how a user tells nine parallel agents apart at a glance, so the contrast
// decision is functional, not decorative: black text on a dark badge is unreadable in both
// the grid and the single view.
describe("badgeStyleFor", () => {
  it("puts dark text on a bright badge", () => {
    expect(badgeStyleFor("#ffffff")).toEqual({ background: "#ffffff", color: "#000" });
  });

  it("puts light text on a dark badge", () => {
    expect(badgeStyleFor("#000000")).toEqual({ background: "#000000", color: "#fff" });
  });

  // Perceived brightness, not raw magnitude: the same channel value reads very differently
  // depending on which channel it is in.
  it("weighs the channels by how bright they look, not by their value", () => {
    expect(badgeStyleFor("#80ff80").color).toBe("#000"); // 202.6
    expect(badgeStyleFor("#8080ff").color).toBe("#fff"); // 142.5
  });

  // Recorded because it is surprising rather than because it is right: pure green scores
  // 0.587 x 255 = 149.685, a fraction under the 150 threshold, so a vivid green badge gets
  // WHITE text. Worth a look if a green badge ever reads as hard to see — the fix would be
  // the threshold, which changes existing badges, so it is not made here.
  it("gives pure green light text, just under the threshold", () => {
    expect(badgeStyleFor("#00ff00").color).toBe("#fff");
  });

  it("keeps a mid grey on the light side of the threshold", () => {
    // 0.299·155 + 0.587·155 + 0.114·155 = 155 > 150
    expect(badgeStyleFor("#9b9b9b").color).toBe("#000");
    // …and 140 < 150.
    expect(badgeStyleFor("#8c8c8c").color).toBe("#fff");
  });

  it("accepts upper-case hex", () => {
    expect(badgeStyleFor("#FFFFFF")).toEqual({ background: "#FFFFFF", color: "#000" });
  });

  // Anything that is not a full six-digit hex falls back to the neutral chip rather than
  // being handed to the browser as a background it may or may not understand.
  it.each([[null], [undefined], [""], ["#fff"], ["red"], ["#gggggg"], ["#ffffff00"], [" #ffffff"]])("falls back to the neutral chip for %j", (color) => {
    expect(badgeStyleFor(color)).toEqual({ background: "var(--bg-elevated)", color: "var(--text-secondary)" });
  });

  it("returns a fresh object each call, so one badge cannot restyle another", () => {
    const first = badgeStyleFor("#123456");
    first.background = "mutated";
    expect(badgeStyleFor("#123456").background).toBe("#123456");
  });
});
