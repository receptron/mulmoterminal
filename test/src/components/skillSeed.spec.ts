import { describe, it, expect } from "vitest";
import { skillSeed } from "../../../src/components/skillSeed";

describe("skillSeed", () => {
  it("uses claude's /<slug> command for claude", () => {
    expect(skillSeed("mulmoterminal-config", false)).toBe("/mulmoterminal-config");
  });

  it("names the skill in natural language for codex (no slash command)", () => {
    expect(skillSeed("mulmoterminal-config", true)).toBe('Use the "mulmoterminal-config" skill.');
  });
});
