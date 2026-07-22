import { describe, it, expect } from "vitest";

import { isCellUsage, isCellContext } from "../../../src/components/cellPayload";

const USAGE = { inputTokens: 100, outputTokens: 250, cacheReadTokens: 0, cacheCreationTokens: 30 };
const CONTEXT = { model: "claude-opus-4-8", contextTokens: 42000 };

describe("isCellUsage", () => {
  it("accepts a complete payload", () => {
    expect(isCellUsage(USAGE)).toBe(true);
  });

  it("accepts zeroes", () => {
    expect(isCellUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(true);
  });

  it("ignores extra fields the server may add", () => {
    expect(isCellUsage({ ...USAGE, totalCostUsd: 0.12 })).toBe(true);
  });

  // The badge shows every field, so a missing one is a hole in it — the old guard asked only
  // whether outputTokens was present and let the rest through unchecked.
  describe("an incomplete payload", () => {
    it.each(["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"])("refuses one missing %s", (field) => {
      const partial = Object.fromEntries(Object.entries(USAGE).filter(([key]) => key !== field));
      expect(isCellUsage(partial)).toBe(false);
    });

    it("refuses an empty object", () => {
      expect(isCellUsage({})).toBe(false);
    });
  });

  // What a server that could not compute a field actually sends — the case that rendered NaN.
  describe("a field that is not a number", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "250"],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["an object", { value: 250 }],
      ["a boolean", true],
    ])("refuses outputTokens as %s", (_label, value) => {
      expect(isCellUsage({ ...USAGE, outputTokens: value })).toBe(false);
    });
  });

  describe("a payload that is not an object", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a number", 250],
      ["a string", "usage"],
    ])("refuses %s", (_label, value) => {
      expect(isCellUsage(value)).toBe(false);
    });

    // typeof [] is "object", so an array reaches the field checks and fails them.
    it("refuses an array", () => {
      expect(isCellUsage([])).toBe(false);
    });
  });
});

describe("isCellContext", () => {
  it("accepts a complete payload", () => {
    expect(isCellContext(CONTEXT)).toBe(true);
  });

  // Legitimate before the first assistant turn — the badge hides itself, which is not the
  // same as the field being the wrong type.
  it("accepts a null model", () => {
    expect(isCellContext({ model: null, contextTokens: 0 })).toBe(true);
  });

  it("refuses a missing model", () => {
    expect(isCellContext({ contextTokens: 42 })).toBe(false);
  });

  it.each([
    ["a number", 7],
    ["an object", { name: "opus" }],
    ["undefined", undefined],
  ])("refuses a model that is %s", (_label, value) => {
    expect(isCellContext({ ...CONTEXT, model: value })).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "42000"],
    ["NaN", Number.NaN],
    ["missing", undefined],
  ])("refuses contextTokens as %s", (_label, value) => {
    expect(isCellContext({ ...CONTEXT, contextTokens: value })).toBe(false);
  });

  it("refuses a payload that is not an object", () => {
    expect(isCellContext(null)).toBe(false);
    expect(isCellContext("context")).toBe(false);
  });
});
