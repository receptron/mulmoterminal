// A string without the characters of a set at its end.
import { describe, it, expect } from "vitest";
import { trimEndOf } from "../../common/trimEndOf";
import { seededRandom } from "../helpers/seededRandom";

const CLOSING = new Set([".", ",", ")"]);

describe("trimEndOf", () => {
  it.each([
    ["README.md.", "README.md"],
    ["a.b.c.md),", "a.b.c.md"],
    ["...", ""],
    ["", ""],
    ["no trailing", "no trailing"],
    ["emoji \u{1F642}.", "emoji \u{1F642}"],
  ])("%j → %j", (text, trimmed) => {
    expect(trimEndOf(text, CLOSING)).toBe(trimmed);
  });

  it("over generated text: a prefix of it, ending in none of the set, with only the set's characters cut", () => {
    const random = seededRandom(20261121);
    const alphabet = ["a", ".", ",", ")", "/", "\u{1F642}", " "];
    Array.from({ length: 2000 }, () => Array.from({ length: random.below(10) }, () => random.pick(alphabet)).join("")).forEach((text) => {
      const trimmed = trimEndOf(text, CLOSING);
      expect(text.startsWith(trimmed)).toBe(true);
      expect(CLOSING.has(trimmed.charAt(trimmed.length - 1))).toBe(false);
      expect([...text.slice(trimmed.length)].every((char) => CLOSING.has(char))).toBe(true);
    });
  });
});
