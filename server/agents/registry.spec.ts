import { describe, it, expect, afterEach } from "vitest";
import { getAgentAdapter } from "./registry.js";
import { claudeAdapter } from "./claude.js";

describe("agent registry", () => {
  const originalBin = process.env.CLAUDE_BIN;
  afterEach(() => {
    if (originalBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = originalBin;
  });

  it("defaults to the Claude adapter", () => {
    expect(getAgentAdapter().kind).toBe("claude");
    expect(getAgentAdapter("claude")).toBe(claudeAdapter);
  });

  it("resolves the Claude binary from CLAUDE_BIN, falling back to 'claude'", () => {
    delete process.env.CLAUDE_BIN;
    expect(claudeAdapter.bin()).toBe("claude");
    process.env.CLAUDE_BIN = "/custom/path/claude";
    expect(claudeAdapter.bin()).toBe("/custom/path/claude");
  });

  it("matches Claude's draft-ready TUI hint", () => {
    expect(claudeAdapter.draftReadyMarker.test("... press shift+tab to cycle modes")).toBe(true);
    expect(claudeAdapter.draftReadyMarker.test("no hint here")).toBe(false);
  });
});
