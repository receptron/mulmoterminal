import { describe, it, expect } from "vitest";

import { mcpConfigJson, guiMcpEnv, codexGuiMcpServers } from "../../../server/session/mcp-config.js";
import { guiMcpUrlTemplate } from "../../../server/infra/gui-mcp-registration.js";
import { TOOL_GROUPS, toolsInGroup, toolGroupServerId, AUTO_ALLOWED_TOOLS, type ToolGroup } from "../../../common/toolGroups.js";

const SESSION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GUI = "mulmoterminal-gui";

const config = (over: Partial<Parameters<typeof mcpConfigJson>[0]> = {}) =>
  JSON.parse(mcpConfigJson({ sessionId: SESSION, port: 34567, userMcpServers: [], ...over })).mcpServers as Record<string, { type: string; url: string }>;

describe("mcpConfigJson", () => {
  it("points the session at this server's own GUI MCP endpoint", () => {
    expect(config()[GUI]).toEqual({ type: "http", url: `http://127.0.0.1:34567/api/mcp/${SESSION}` });
  });

  // Not "localhost": that can resolve to ::1 while the server listens on 127.0.0.1.
  it("defaults to the numeric loopback host", () => {
    expect(config()[GUI].url).toContain("http://127.0.0.1:");
  });

  it("uses the host it is given", () => {
    expect(config({ host: "gateway.example" })[GUI].url).toBe(`http://gateway.example:34567/api/mcp/${SESSION}`);
  });

  it("takes the port as given, whether a number or a string", () => {
    expect(config({ port: "8080" })[GUI].url).toContain(":8080/");
  });

  describe("with no user servers", () => {
    it("offers the GUI server alone", () => {
      expect(Object.keys(config())).toEqual([GUI]);
    });
  });

  describe("with user servers", () => {
    const userMcpServers = [
      { id: "notes", url: "https://notes.example.com/mcp" },
      { id: "local-tool", url: "http://localhost:7000/mcp" },
    ];

    it("offers each one over http alongside the GUI server", () => {
      const servers = config({ userMcpServers });
      expect(servers.notes).toEqual({ type: "http", url: "https://notes.example.com/mcp" });
      expect(servers["local-tool"]).toEqual({ type: "http", url: "http://localhost:7000/mcp" });
      expect(servers[GUI]).toBeDefined();
    });

    // sanitizeUserMcpServers already reserves the id; this is the defense in depth behind it,
    // and the reason the user's entries are written first.
    it("lets the built-in GUI entry win when a user server claims its id", () => {
      const servers = config({ userMcpServers: [{ id: GUI, url: "http://evil.example.com/mcp" }] });
      expect(servers[GUI].url).toBe(`http://127.0.0.1:34567/api/mcp/${SESSION}`);
      expect(Object.keys(servers)).toEqual([GUI]);
    });
  });
  it("produces parseable JSON", () => {
    expect(() => JSON.parse(mcpConfigJson({ sessionId: SESSION, port: 34567, userMcpServers: [] }))).not.toThrow();
  });
});

// A grid cell gets no --mcp-config: its GUI tools come from the user's own per-folder MCP
// config, where the url is a static string. Claude Code expands ${VAR} in it at connect time,
// so the session id and port reach the url through the environment instead.
describe("guiMcpEnv", () => {
  it("carries the port and session id the url template interpolates", () => {
    expect(guiMcpEnv("abc-123", 34567)).toEqual({ MULMOTERMINAL_PORT: "34567", MULMOTERMINAL_SESSION_ID: "abc-123" });
  });

  it("stringifies a port given as a string too", () => {
    expect(guiMcpEnv("abc-123", "8080").MULMOTERMINAL_PORT).toBe("8080");
  });
});

// codex takes its MCP servers as `-c mcp_servers.<id>.url=` at spawn rather than from a config
// file, and has no `${VAR}` expansion — so unlike claude's grid template these are resolved here.
// The two agents must land on the SAME urls: the group URL is what tells the server a session has
// that group (see mcp-routes), and a codex cell that spelled it differently would light no Canvas.
describe("codexGuiMcpServers", () => {
  it("gives the single view the all-tools url under the gui server id", () => {
    expect(codexGuiMcpServers({ sessionId: SESSION, port: 34567, groups: [], allTools: true })).toEqual([
      { id: GUI, url: `http://127.0.0.1:34567/api/mcp/${SESSION}`, autoApprove: true },
    ]);
  });

  // The single view carries every tool on one URL, so a group list is not consulted there —
  // passing both must not produce five servers.
  it("ignores the groups when the whole GUI MCP is attached", () => {
    expect(codexGuiMcpServers({ sessionId: SESSION, port: 34567, groups: ["render", "media"], allTools: true })).toHaveLength(1);
  });

  it("gives a grid cell one url per registered group", () => {
    expect(codexGuiMcpServers({ sessionId: SESSION, port: 34567, groups: ["render", "media"], allTools: false }).map((s) => [s.id, s.url])).toEqual([
      ["mulmoterminal-render", `http://127.0.0.1:34567/api/mcp/render/${SESSION}`],
      ["mulmoterminal-media", `http://127.0.0.1:34567/api/mcp/media/${SESSION}`],
    ]);
  });

  // The url claude's own registration expands to, modulo the two values it takes from the
  // environment. Spelled out rather than derived, so a change to either side shows up here.
  it("matches the shape claude's grid template expands to", () => {
    const [{ url }] = codexGuiMcpServers({ sessionId: SESSION, port: 34567, groups: ["render"], allTools: false });
    expect(guiMcpUrlTemplate("render").replace("${MULMOTERMINAL_PORT}", "34567").replace("${MULMOTERMINAL_SESSION_ID}", SESSION)).toBe(url);
  });

  // Nothing registered means no GUI tools, which is exactly what a grid codex cell had before
  // the groups were wired — not a silent fallback to everything.
  it("gives a directory that registered nothing no servers at all", () => {
    expect(codexGuiMcpServers({ sessionId: SESSION, port: 34567, groups: [], allTools: false })).toEqual([]);
  });
});

// codex approves per SERVER; claude is handed a list of TOOLS (AUTO_ALLOWED_TOOLS, which withholds
// the ones that can spend money). The same list cannot be expressed here — a group is waved through
// as a whole, or every call in it asks — and the owner chose to wave it through (2026-07-28). So a
// codex cell can spend on presentDocument / generateImage without asking while a claude cell in the
// same directory still asks. Pinned because it is a deliberate asymmetry, not a leftover.
describe("codexGuiMcpServers auto-approval", () => {
  const groupsOf = (groups: ToolGroup[]) => codexGuiMcpServers({ sessionId: SESSION, port: 34567, groups, allTools: false });

  it("approves every group it attaches", () => {
    const servers = groupsOf([...TOOL_GROUPS]);
    expect(servers).toHaveLength(TOOL_GROUPS.length);
    for (const server of servers) expect(server.autoApprove).toBe(true);
  });

  // The group claude keeps entirely behind a prompt. Named rather than left to the loop above, so
  // narrowing the policy later has to change a test that says what it is giving up.
  it("approves media too, whose tools claude never auto-allows", () => {
    const [media] = groupsOf(["media"]);
    expect(media.id).toBe(toolGroupServerId("media"));
    expect(media.autoApprove).toBe(true);
    expect(toolsInGroup("media").some((tool) => AUTO_ALLOWED_TOOLS.includes(tool))).toBe(false);
  });

  // The single view carries every tool under one id and has been approved wholesale since it was
  // wired; narrowing it here would start prompting in a setup that works today.
  it("leaves the single view approved", () => {
    expect(codexGuiMcpServers({ sessionId: SESSION, port: 34567, groups: [], allTools: true })[0].autoApprove).toBe(true);
  });
});
