import { describe, it, expect, afterEach } from "vitest";
import { getAgentAdapter } from "../../../server/agents/registry.js";
import { claudeAdapter } from "../../../server/agents/claude.js";
import { codexAdapter } from "../../../server/agents/codex.js";
import { antigravityAdapter } from "../../../server/agents/antigravity.js";
import { squashForMarker } from "../../../server/session/pty-scan.js";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
}

describe("agent registry", () => {
  const originalClaudeBin = process.env.CLAUDE_BIN;
  const originalCodexBin = process.env.CODEX_BIN;
  const originalAntigravityBin = process.env.ANTIGRAVITY_BIN;
  afterEach(() => {
    restoreEnv("CLAUDE_BIN", originalClaudeBin);
    restoreEnv("CODEX_BIN", originalCodexBin);
    restoreEnv("ANTIGRAVITY_BIN", originalAntigravityBin);
  });

  it("defaults to the Claude adapter", () => {
    expect(getAgentAdapter().kind).toBe("claude");
    expect(getAgentAdapter("claude")).toBe(claudeAdapter);
  });

  it("resolves the codex adapter", () => {
    expect(getAgentAdapter("codex").kind).toBe("codex");
    expect(getAgentAdapter("codex")).toBe(codexAdapter);
  });

  it("resolves the antigravity adapter", () => {
    expect(getAgentAdapter("antigravity").kind).toBe("antigravity");
    expect(getAgentAdapter("antigravity")).toBe(antigravityAdapter);
  });

  it("reads each agent's binary from its env override, with a sensible default", () => {
    delete process.env.CLAUDE_BIN;
    delete process.env.CODEX_BIN;
    delete process.env.ANTIGRAVITY_BIN;
    expect(claudeAdapter.bin()).toBe("claude");
    expect(codexAdapter.bin()).toBe("codex");
    expect(antigravityAdapter.bin()).toBe("agy");
    process.env.CLAUDE_BIN = "/custom/claude";
    process.env.CODEX_BIN = "/custom/codex";
    process.env.ANTIGRAVITY_BIN = "/custom/agy";
    expect(claudeAdapter.bin()).toBe("/custom/claude");
    expect(codexAdapter.bin()).toBe("/custom/codex");
    expect(antigravityAdapter.bin()).toBe("/custom/agy");
  });

  // The marker is matched against squashForMarker's output, so it is spelled without spaces —
  // asserted here against real status lines put through that same function, because a marker that
  // reads correctly and matches nothing a terminal sends is exactly the bug this shape fixes.
  it("exposes Claude's draft-ready marker but not codex or antigravity (not wired yet)", () => {
    expect(claudeAdapter.draftReadyMarker.test(squashForMarker("⏵⏵ auto mode on (shift+tab to cycle)"))).toBe(true);
    // What 2.1.220 prints, and how it prints it: the words arrive separated by cursor moves.
    expect(claudeAdapter.draftReadyMarker.test(squashForMarker("⏸ manual mode on · ? for shortcuts"))).toBe(true);
    expect(claudeAdapter.draftReadyMarker.test(squashForMarker("\u001b[3G⏸\u001b[5Gmanual\u001b[20G·\u001b[22G?\u001b[24Gfor\u001b[28Gshortcuts"))).toBe(true);
    // Not every "shift+tab" hint means an input box: this one is a review prompt.
    expect(claudeAdapter.draftReadyMarker.test(squashForMarker("shift+tab to approve with this feedback"))).toBe(false);
    expect(getAgentAdapter("codex").draftReadyMarker).toBeUndefined();
    expect(getAgentAdapter("antigravity").draftReadyMarker).toBeUndefined();
  });
});
