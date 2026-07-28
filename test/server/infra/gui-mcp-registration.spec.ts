import { describe, it, expect } from "vitest";

import { guiMcpUrlTemplate, listMentionsServer } from "../../../server/infra/gui-mcp-registration.js";

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

describe("listMentionsServer", () => {
  const list = ["mulmoterminal-render: http://127.0.0.1:34567/api/mcp/render/x - connected", "playwright: npx @playwright/mcp - connected"].join("\n");

  it("finds a registered server", () => {
    expect(listMentionsServer(list, "mulmoterminal-render")).toBe(true);
  });

  it("does not find one that is absent", () => {
    expect(listMentionsServer(list, "mulmoterminal-data")).toBe(false);
  });

  // The id also appears INSIDE the url of the line above it. Matching anywhere in the output
  // would report every group as registered as soon as one was.
  it("matches the id at the start of a line, not inside another server's url", () => {
    expect(listMentionsServer("other: http://x/api/mcp/render/y - ok", "render")).toBe(false);
  });

  it("tolerates indentation", () => {
    expect(listMentionsServer("   mulmoterminal-render: http://x - ok", "mulmoterminal-render")).toBe(true);
  });

  it("reads empty output as nothing registered", () => {
    expect(listMentionsServer("", "mulmoterminal-render")).toBe(false);
  });
});
