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

  // Green carries far more perceived light than blue, so the same channel value reads very
  // differently depending on which channel it is in.
  it("weighs the channels by how bright they look, not by their value", () => {
    // The same channel value: green carries most of the perceived light, blue almost none.
    expect(badgeStyleFor("#00ff00").color).toBe("#000");
    expect(badgeStyleFor("#0000ff").color).toBe("#fff");
  });

  // Was the other way round until #308: the old brightness approximation scored pure green a
  // fraction under its threshold and chose white, at a contrast ratio of 1.37:1.
  it("gives a mid green dark text", () => {
    expect(badgeStyleFor("#22c55e").color).toBe("#000");
  });

  // A mid grey is darker than it looks once gamma is accounted for, but black still wins on
  // both of these — the old rule flipped one of them to white.
  it("gives mid greys dark text", () => {
    expect(badgeStyleFor("#9b9b9b").color).toBe("#000");
    expect(badgeStyleFor("#8c8c8c").color).toBe("#000");
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
