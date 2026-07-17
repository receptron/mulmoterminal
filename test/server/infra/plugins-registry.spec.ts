// @vitest-environment node
// The registry resolves plugins.json at import time (top-level await), so importing it
// here IS the end-to-end check that every configured package still loads. The factory
// path matters most: @mulmoclaude/google-plugin exports only TOOL_DEFINITION + a
// definePlugin default, so a regression in loadFactoryPackage drops the tool entirely.
import { describe, it, expect } from "vitest";

import { plugins, toolDefinitions, allowedToolNames } from "../../../server/infra/../../server/infra/plugins-registry.js";

describe("plugins registry", () => {
  it("normalizes a factory-shaped package into { toolName, definition, execute }", () => {
    const google = plugins.find((plugin) => plugin.toolName === "google");
    expect(google).toBeDefined();
    expect(google?.definition.name).toBe("google");
    expect(typeof google?.execute).toBe("function");
  });

  it("advertises the factory-loaded tool to the MCP broker", () => {
    expect(toolDefinitions.map((definition) => definition.name)).toContain("google");
    expect(allowedToolNames()).toContain("mcp__mulmoterminal-gui__google");
  });

  it("loads every package in plugins.json without a duplicate tool name", () => {
    const names = plugins.map((plugin) => plugin.toolName);
    expect(new Set(names).size).toBe(names.length);
  });
});
