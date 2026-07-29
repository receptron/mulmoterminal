// The broker feeding the tools pane's call history — the only source codex / agy have, since
// neither reports tool calls the way claude's hooks do (server/mcp/gui-call-history.ts).
//
// Driven through a real MCP client over an in-memory transport rather than by reaching for the
// request handler: what matters is that a normal tools/call produces the pair of entries, and a
// handler called directly would not prove the SDK path does.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildGuiMcpServer } from "../../../server/mcp/broker.js";
import type { GuiCallRecorder } from "../../../server/mcp/gui-call-history.js";

interface Recorded {
  starts: { toolUseId: string; toolName: string; toolInput: unknown }[];
  ends: { toolUseId: string; toolName: string; toolOutput: unknown; status: string; durationMs: number }[];
}

const recorder = (): GuiCallRecorder & Recorded => {
  const starts: Recorded["starts"] = [];
  const ends: Recorded["ends"] = [];
  return { starts, ends, start: (c) => void starts.push(c), end: (c) => void ends.push(c) };
};

// The two hosts the broker POSTs to: the plugin dispatch route, and the toolResult sink.
function stubFetch(dispatch: () => { status: number; body: unknown }) {
  return vi.fn(async (url: unknown) => {
    if (String(url).includes("/api/plugin/")) {
      const { status, body } = dispatch();
      return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
  });
}

async function callTool(server: ReturnType<typeof buildGuiMcpServer>, name: string, args: Record<string, unknown>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "spec", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

let fetchSpy: ReturnType<typeof stubFetch>;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("buildGuiMcpServer tool-call history", () => {
  it("records a running entry and then completes it", async () => {
    fetchSpy = stubFetch(() => ({ status: 200, body: { message: "Rendered.", data: { html: "<p/>" } } }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const history = recorder();
    const server = buildGuiMcpServer("11111111-1111-4111-8111-111111111111", "http://127.0.0.1:1", { history });

    await callTool(server, "presentHtml", { html: "<p/>" });

    expect(history.starts).toHaveLength(1);
    expect(history.starts[0].toolName).toBe("presentHtml");
    expect(history.starts[0].toolInput).toEqual({ html: "<p/>" });
    expect(history.ends).toHaveLength(1);
    // Same id on both, so the store completes the entry in place rather than appending a second.
    expect(history.ends[0].toolUseId).toBe(history.starts[0].toolUseId);
    expect(history.ends[0].status).toBe("completed");
    expect(history.ends[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  // Without this the entry would sit on "running…" for the life of the session — the same reason
  // claude registers PostToolUseFailure alongside PostToolUse.
  it("closes the entry as failed when the plugin dispatch fails", async () => {
    fetchSpy = stubFetch(() => ({ status: 500, body: {} }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const history = recorder();
    const server = buildGuiMcpServer("11111111-1111-4111-8111-111111111111", "http://127.0.0.1:1", { history });

    // The error still reaches the agent as an error response — recording it must not swallow it.
    await expect(callTool(server, "presentHtml", { html: "<p/>" })).rejects.toThrow(/500/);

    expect(history.starts).toHaveLength(1);
    expect(history.ends).toHaveLength(1);
    expect(history.ends[0].status).toBe("failed");
  });

  // A tool the agent named and was refused (outside its group) is exactly what someone reading
  // the history is looking for.
  it("records a refused tool as a failed call", async () => {
    fetchSpy = stubFetch(() => ({ status: 200, body: {} }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const history = recorder();
    const server = buildGuiMcpServer("11111111-1111-4111-8111-111111111111", "http://127.0.0.1:1", { history, group: "render" });

    await callTool(server, "manageCollection", { action: "list" });

    expect(history.ends).toHaveLength(1);
    expect(history.ends[0].status).toBe("failed");
    // Refused before dispatch: the plugin route is never called.
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes("/api/plugin/"))).toBe(false);
  });

  // Claude gets no recorder at all (its hooks already report the call), and the broker must work
  // exactly as before when there is none.
  it("serves the call normally with no recorder", async () => {
    fetchSpy = stubFetch(() => ({ status: 200, body: { message: "Rendered." } }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const server = buildGuiMcpServer("11111111-1111-4111-8111-111111111111", "http://127.0.0.1:1", {});

    const result = await callTool(server, "presentHtml", { html: "<p/>" });

    expect(JSON.stringify(result.content)).toContain("Rendered.");
  });
});
