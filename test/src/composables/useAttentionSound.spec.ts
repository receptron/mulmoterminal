import { describe, it, expect } from "vitest";
import { needsAttention } from "./useAttentionSound";

const msg = (id: string, working?: boolean, waiting?: boolean) => ({ id, working, waiting });

describe("needsAttention", () => {
  it("fires when a turn finishes (working true→false)", () => {
    const prev = new Map();
    needsAttention(prev, msg("a", true, false)); // working baseline
    expect(needsAttention(prev, msg("a", false, false))).toBe(true);
  });

  it("fires when waiting goes false→true", () => {
    const prev = new Map();
    needsAttention(prev, msg("a", false, false));
    expect(needsAttention(prev, msg("a", false, true))).toBe(true);
  });

  it("is baseline-only on first sight (no beep)", () => {
    expect(needsAttention(new Map(), msg("a", false, true))).toBe(false);
    expect(needsAttention(new Map(), msg("a", true, false))).toBe(false);
  });

  it("does not fire while still working", () => {
    const prev = new Map();
    needsAttention(prev, msg("a", true, false));
    expect(needsAttention(prev, msg("a", true, false))).toBe(false);
  });

  it("does not fire when work starts (working false→true)", () => {
    const prev = new Map();
    needsAttention(prev, msg("a", false, false));
    expect(needsAttention(prev, msg("a", true, false))).toBe(false);
  });

  it("treats missing fields as not-working / not-waiting", () => {
    const prev = new Map();
    needsAttention(prev, msg("a", true)); // working, no waiting field
    expect(needsAttention(prev, { id: "a" })).toBe(true); // working dropped to false = finished
  });

  it("tracks sessions independently", () => {
    const prev = new Map();
    needsAttention(prev, msg("a", true, false));
    needsAttention(prev, msg("b", true, false));
    expect(needsAttention(prev, msg("b", false, false))).toBe(true);
    expect(needsAttention(prev, msg("a", true, false))).toBe(false);
  });
});
