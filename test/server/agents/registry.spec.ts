import { describe, it, expect, afterEach } from "vitest";
import { getAgentAdapter } from "../../../server/agents/registry.js";
import { claudeAdapter } from "../../../server/agents/claude.js";
import { codexAdapter } from "../../../server/agents/codex.js";
import { antigravityAdapter } from "../../../server/agents/antigravity.js";

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

  it("exposes Claude's draft-ready marker but not codex or antigravity (not wired yet)", () => {
    expect(claudeAdapter.draftReadyMarker.test("... press shift+tab to cycle modes")).toBe(true);
    expect(getAgentAdapter("codex").draftReadyMarker).toBeUndefined();
    expect(getAgentAdapter("antigravity").draftReadyMarker).toBeUndefined();
  });
});
