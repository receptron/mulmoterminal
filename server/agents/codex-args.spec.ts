import { describe, it, expect } from "vitest";
import { buildCodexArgs } from "./codex-args.js";

const base = { resume: null, model: null, guiMcpUrl: null };

describe("buildCodexArgs", () => {
  it("passes no id for a fresh session (codex mints its own)", () => {
    expect(buildCodexArgs({ ...base })).toEqual([]);
  });

  it("adds the model override before the subcommand", () => {
    expect(buildCodexArgs({ ...base, model: "gpt-5.4" })).toEqual(["--model", "gpt-5.4"]);
  });

  it("resumes a known rollout id via the resume subcommand", () => {
    expect(buildCodexArgs({ ...base, resume: "019f251d-001c-7542-b13e-9a627effce52" })).toEqual(["resume", "019f251d-001c-7542-b13e-9a627effce52"]);
  });

  it("keeps global flags ahead of the resume subcommand", () => {
    expect(buildCodexArgs({ ...base, resume: "abc", model: "gpt-5.4" })).toEqual(["--model", "gpt-5.4", "resume", "abc"]);
  });

  it("injects the GUI MCP server + auto-approval via -c when a url is given", () => {
    // Opaque endpoint token — buildCodexArgs embeds it verbatim (the real value is an
    // interpolated loopback URL; a static http literal here trips no-clear-text-protocols).
    const url = "gui-mcp-endpoint";
    expect(buildCodexArgs({ ...base, guiMcpUrl: url })).toEqual([
      "-c",
      `mcp_servers.mulmoterminal-gui.url="${url}"`,
      "-c",
      `mcp_servers.mulmoterminal-gui.default_tools_approval_mode="approve"`,
    ]);
  });

  it("orders model, GUI MCP, then the resume subcommand (no positional prompt)", () => {
    const args = buildCodexArgs({ resume: "id1", model: "gpt-5.4", guiMcpUrl: "gui-mcp-endpoint" });
    expect(args.slice(0, 2)).toEqual(["--model", "gpt-5.4"]);
    expect(args).toContain("-c");
    expect(args.slice(-2)).toEqual(["resume", "id1"]);
  });
});
