import { describe, it, expect } from "vitest";
import { skillSeed } from "../../../src/components/skillSeed.js";

describe("skillSeed", () => {
  it("uses claude's /<slug> command for claude", () => {
    expect(skillSeed("mulmoterminal-config", "claude")).toBe("/mulmoterminal-config");
  });

  it("names the skill in natural language for codex (no slash command)", () => {
    expect(skillSeed("mulmoterminal-config", "codex")).toBe('Use the "mulmoterminal-config" skill.');
    // Claude is the exception, not the rule: an agent without slash commands gets the sentence.
    expect(skillSeed("mulmoterminal-config", "antigravity")).toBe('Use the "mulmoterminal-config" skill.');
  });
});
