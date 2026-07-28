import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { guiMcpUrlTemplate, registeredGuiMcpGroups } from "../../../server/infra/gui-mcp-registration.js";
import { TOOL_GROUPS } from "../../../common/toolGroups.js";

// The url is registered ONCE, into the user's own Claude Code config, and then read at every
// connect. It has to stay a template: the port and session id are only known per spawn, and
// Claude Code is what expands them (verified against the real CLI).
describe("guiMcpUrlTemplate", () => {
  it("leaves the port and session id as ${VAR} for Claude Code to expand", () => {
    expect(guiMcpUrlTemplate("render")).toBe("http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/render/${MULMOTERMINAL_SESSION_ID}");
  });

  it("puts the group in the path, so one server id maps to one group", () => {
    expect(guiMcpUrlTemplate("data")).toContain("/api/mcp/data/");
    expect(guiMcpUrlTemplate("external")).toContain("/api/mcp/external/");
  });

  // 127.0.0.1 rather than localhost, for the same reason mcp-config.ts uses it: an IPv6/IPv4
  // resolution mismatch against the server's listen address.
  it("addresses the loopback numerically", () => {
    expect(guiMcpUrlTemplate("render").startsWith("http://127.0.0.1:")).toBe(true);
  });
});

// Read from the config FILES, never by running `claude mcp list` — that command health-checks
// every registered server first, and the launcher was paying that wait before it could draw the
// Canvas switch.
describe("registeredGuiMcpGroups", () => {
  let root = "";
  let home = "";
  let cwd = "";
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;

  const writeClaudeConfig = (value: unknown) => writeFileSync(path.join(home, ".claude.json"), JSON.stringify(value));

  beforeEach(() => {
    // realpath'd: on macOS the temp dir is itself behind a symlink (/var -> /private/var), which
    // would make every path in here exercise the symlink case by accident.
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "gui-mcp-")));
    home = path.join(root, "home");
    cwd = path.join(root, "repo");
    mkdirSync(home);
    mkdirSync(cwd);
    process.env.CLAUDE_CONFIG_DIR = home;
  });

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    rmSync(root, { recursive: true, force: true });
  });

  it("reports the groups registered for this directory in local scope", async () => {
    writeClaudeConfig({ projects: { [cwd]: { mcpServers: { "mulmoterminal-render": { type: "http" } } } } });
    expect(await registeredGuiMcpGroups(cwd, TOOL_GROUPS)).toEqual(["render"]);
  });

  // Local scope is keyed by directory: another project's registration is not this one's.
  it("does not report a group registered for a different directory", async () => {
    writeClaudeConfig({ projects: { [path.join(root, "elsewhere")]: { mcpServers: { "mulmoterminal-render": {} } } } });
    expect(await registeredGuiMcpGroups(cwd, TOOL_GROUPS)).toEqual([]);
  });

  // The three scopes `claude mcp list` merges are the three the session will actually get.
  it("also counts user scope and the repo's .mcp.json", async () => {
    writeClaudeConfig({ mcpServers: { "mulmoterminal-media": {} } });
    writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { "mulmoterminal-data": {} } }));
    expect((await registeredGuiMcpGroups(cwd, TOOL_GROUPS)).sort()).toEqual(["data", "media"]);
  });

  // Claude Code keys local scope by its own resolved cwd; ours is canonicalized only lexically.
  it("matches a directory reached through a symlink", async () => {
    const link = path.join(root, "link");
    symlinkSync(cwd, link);
    writeClaudeConfig({ projects: { [cwd]: { mcpServers: { "mulmoterminal-render": {} } } } });
    expect(await registeredGuiMcpGroups(link, TOOL_GROUPS)).toEqual(["render"]);
  });

  // The file is rewritten live by Claude Code, so a read can land mid-write.
  it("reads a missing or unparsable config as nothing registered", async () => {
    expect(await registeredGuiMcpGroups(cwd, TOOL_GROUPS)).toEqual([]);
    writeFileSync(path.join(home, ".claude.json"), "{ half-writ");
    expect(await registeredGuiMcpGroups(cwd, TOOL_GROUPS)).toEqual([]);
  });

  // An indexed lookup would resolve these through Object.prototype and report a group that the
  // user never registered.
  it("does not read inherited object members as registrations", async () => {
    writeClaudeConfig({ projects: { [cwd]: { mcpServers: { constructor: {}, toString: {} } } } });
    expect(await registeredGuiMcpGroups(cwd, TOOL_GROUPS)).toEqual([]);
  });
});
