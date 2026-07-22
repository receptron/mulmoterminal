import { describe, it, expect } from "vitest";

import { mcpConfigJson } from "../../../server/session/mcp-config.js";
import { SANDBOX_HOST } from "../../../server/infra/sandbox.js";

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

  it("uses the host it is given, which is how a container reaches the host machine", () => {
    expect(config({ host: SANDBOX_HOST })[GUI].url).toBe(`http://${SANDBOX_HOST}:34567/api/mcp/${SESSION}`);
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

  describe("in the sandbox", () => {
    it("rewrites a user server's loopback host so the container can reach it", () => {
      const servers = config({ sandbox: true, userMcpServers: [{ id: "local-tool", url: "http://localhost:7000/mcp" }] });
      expect(servers["local-tool"].url).toBe(`http://${SANDBOX_HOST}:7000/mcp`);
    });

    it("rewrites the numeric loopback too", () => {
      const servers = config({ sandbox: true, userMcpServers: [{ id: "local-tool", url: "http://127.0.0.1:7000/mcp" }] });
      expect(servers["local-tool"].url).toBe(`http://${SANDBOX_HOST}:7000/mcp`);
    });

    it("leaves a remote user server alone", () => {
      const servers = config({ sandbox: true, userMcpServers: [{ id: "notes", url: "https://notes.example.com/mcp" }] });
      expect(servers.notes.url).toBe("https://notes.example.com/mcp");
    });

    // The GUI entry is built from the host parameter, never rewritten — the caller is the one
    // that knows to pass the gateway host for a sandboxed spawn.
    it("does not rewrite the GUI entry, which is built from the host it was given", () => {
      expect(config({ sandbox: true })[GUI].url).toBe(`http://127.0.0.1:34567/api/mcp/${SESSION}`);
    });

    it("leaves user servers alone when not sandboxed", () => {
      const servers = config({ sandbox: false, userMcpServers: [{ id: "local-tool", url: "http://localhost:7000/mcp" }] });
      expect(servers["local-tool"].url).toBe("http://localhost:7000/mcp");
    });
  });

  it("produces parseable JSON", () => {
    expect(() => JSON.parse(mcpConfigJson({ sessionId: SESSION, port: 34567, userMcpServers: [] }))).not.toThrow();
  });
});
