import { describe, it, expect } from "vitest";
import { buildClaudeArgs, type ClaudeArgsInput } from "./claude-args.js";

const base: ClaudeArgsInput = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  resume: null,
  canResume: false,
  settings: "{hooks}",
  permissionMode: "auto",
  attachGuiMcp: true,
  mcpConfig: "{gui-mcp}",
  guiMcpTools: "mcp__gui__a,mcp__gui__b",
};

describe("buildClaudeArgs", () => {
  it("single view (attachGuiMcp): attaches GUI MCP + --strict-mcp-config + --allowedTools", () => {
    const args = buildClaudeArgs(base);
    expect(args).toEqual([
      "--session-id",
      base.sessionId,
      "--settings",
      "{hooks}",
      "--permission-mode",
      "auto",
      "--mcp-config",
      "{gui-mcp}",
      "--strict-mcp-config",
      "--allowedTools",
      "mcp__gui__a,mcp__gui__b",
    ]);
  });

  it("grid dev terminal (attachGuiMcp=false): no GUI MCP, no --strict-mcp-config, no --allowedTools", () => {
    const args = buildClaudeArgs({ ...base, attachGuiMcp: false });
    expect(args).toEqual(["--session-id", base.sessionId, "--settings", "{hooks}", "--permission-mode", "auto"]);
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--allowedTools");
  });

  it("resumes with --resume when canResume, keeping the chosen MCP mode", () => {
    const resume = "22222222-2222-2222-2222-222222222222";
    const args = buildClaudeArgs({ ...base, attachGuiMcp: false, resume, canResume: true });
    expect(args.slice(0, 4)).toEqual(["--resume", resume, "--settings", "{hooks}"]);
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--strict-mcp-config");
  });

  it("falls back to --session-id when canResume is false even if a resume id is present", () => {
    const args = buildClaudeArgs({ ...base, resume: "33333333-3333-3333-3333-333333333333", canResume: false });
    expect(args).toContain("--session-id");
    expect(args).not.toContain("--resume");
  });

  it("appends the initial prompt as a positional after -- (option terminator)", () => {
    const args = buildClaudeArgs({ ...base, initialPrompt: "-rf danger" });
    expect(args.slice(-2)).toEqual(["--", "-rf danger"]);
  });
});
