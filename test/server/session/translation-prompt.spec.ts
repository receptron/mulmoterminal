import { describe, it, expect } from "vitest";
import { buildTranslationPrompt, isValidTranslationResult } from "../../../server/session/translation-prompt.js";

describe("buildTranslationPrompt", () => {
  it("states the count in both places the model must match", () => {
    const p = buildTranslationPrompt("ja", ["a", "b", "c"]);
    expect(p).toContain("each of the 3 English strings");
    expect(p).toContain("exactly 3 strings");
  });

  it("names the target language", () => {
    expect(buildTranslationPrompt("fr-CA", ["a"])).toContain("BCP-47 code: fr-CA");
  });

  // A text reply is discarded by the caller, so the prompt has to shut that door.
  it("names the tool call as the only delivery mechanism", () => {
    const p = buildTranslationPrompt("ja", ["a"]);
    expect(p).toContain("submitTranslation");
    expect(p).toContain("ONLY way to return the result");
  });

  it("embeds the inputs as JSON so quotes and newlines survive", () => {
    expect(buildTranslationPrompt("ja", ['He said "hi"', "line\nbreak"])).toContain(JSON.stringify(['He said "hi"', "line\nbreak"]));
  });

  it("tells the model to keep placeholders verbatim", () => {
    expect(buildTranslationPrompt("ja", ["Hi {name}"])).toContain("{name}");
  });

  it("handles an empty input list without breaking the count", () => {
    expect(buildTranslationPrompt("ja", [])).toContain("each of the 0 English strings");
  });
});

describe("isValidTranslationResult", () => {
  it("accepts one string per input", () => {
    expect(isValidTranslationResult(["a", "b"], 2)).toBe(true);
  });

  // A short answer no longer lines up with the inputs, so it is worse than none.
  it("rejects a count that does not match", () => {
    expect(isValidTranslationResult(["a"], 2)).toBe(false);
    expect(isValidTranslationResult(["a", "b", "c"], 2)).toBe(false);
  });

  it("rejects non-string entries", () => {
    expect(isValidTranslationResult(["a", 2], 2)).toBe(false);
    expect(isValidTranslationResult(["a", null], 2)).toBe(false);
  });

  it("rejects anything that is not an array", () => {
    expect(isValidTranslationResult("a", 1)).toBe(false);
    expect(isValidTranslationResult(undefined, 1)).toBe(false);
    expect(isValidTranslationResult({ 0: "a", length: 1 }, 1)).toBe(false);
  });

  it("accepts an empty answer only for an empty request", () => {
    expect(isValidTranslationResult([], 0)).toBe(true);
    expect(isValidTranslationResult([], 1)).toBe(false);
  });
});
