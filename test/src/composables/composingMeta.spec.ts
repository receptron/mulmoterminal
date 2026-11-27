import { describe, it, expect } from "vitest";

import { isMetaDuringComposition } from "../../../src/composables/composingMeta";

type Shape = Parameters<typeof isMetaDuringComposition>[0];
const key = (over: Partial<Shape> = {}): Shape => ({ type: "keydown", key: "Meta", isComposing: true, ...over });

describe("isMetaDuringComposition", () => {
  it("is true for a Meta keydown while composing", () => {
    expect(isMetaDuringComposition(key())).toBe(true);
  });

  it("is false for Meta when no composition is open", () => {
    expect(isMetaDuringComposition(key({ isComposing: false }))).toBe(false);
  });

  it("is false for the Meta keyup, which xterm's composition helper does not act on", () => {
    expect(isMetaDuringComposition(key({ type: "keyup" }))).toBe(false);
  });

  it("is false for keypress and any other event type", () => {
    ["keypress", "", "compositionend"].forEach((type) => expect(isMetaDuringComposition(key({ type }))).toBe(false));
  });

  it("is false for every other key during a composition, so they still commit as xterm intends", () => {
    ["Process", "Enter", "Escape", "a", "Shift", "Control", "Alt", "Eisu", "KanjiMode", "OS", "meta", "", "Unidentified"].forEach((name) =>
      expect(isMetaDuringComposition(key({ key: name }))).toBe(false),
    );
  });
});
