import { describe, it, expect } from "vitest";
import { terminalManagesAttention, terminalViewActive } from "../../src/components/terminalViewActive.js";

describe("terminalManagesAttention", () => {
  it("a Claude/Codex session terminal manages attention", () => {
    expect(terminalManagesAttention(false, false)).toBe(true);
  });
  it("command and launcher terminals opt out (no attention hooks)", () => {
    expect(terminalManagesAttention(true, false)).toBe(false);
    expect(terminalManagesAttention(false, true)).toBe(false);
  });
});

describe("terminalViewActive", () => {
  it("single view is active whenever shown", () => {
    expect(terminalViewActive(false, false)).toBe(true);
    expect(terminalViewActive(false, true)).toBe(true);
  });
  it("a grid dev-terminal cell is active only while zoomed", () => {
    // Regression for #321: an unfocused (unzoomed) grid cell must NOT be active, or
    // it suppresses its own blocked/done — the bug this whole change fixes.
    expect(terminalViewActive(true, false)).toBe(false);
    expect(terminalViewActive(true, true)).toBe(true);
  });
});
