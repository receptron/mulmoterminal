// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildGuiMcpServer } from "../../../server/mcp/broker.js";
import { dispatchBotTool } from "../../../server/bots/host.js";
import { isBotSession } from "../../../server/bots/session-marker.js";

vi.mock("../../../server/bots/host.js", () => ({ dispatchBotTool: vi.fn(() => ({ received: true })) }));
vi.mock("../../../server/bots/session-marker.js", () => ({ isBotSession: vi.fn(() => false) }));
vi.mock("../../../server/infra/plugins-registry.js", async () => {
  const { BOT_TOOLS } = await import("../../../server/bots/tools.js");
  return { toolDefinitions: [...BOT_TOOLS, { name: "spawnBackgroundChat", parameters: { type: "object", properties: {}, required: [] } }] };
});
afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(isBotSession).mockReturnValue(false);
});
async function connection(run: (client: Client) => Promise<void>, options: Parameters<typeof buildGuiMcpServer>[2] = {}) {
  const server = buildGuiMcpServer("11111111-1111-4111-8111-111111111111", "http://127.0.0.1:1", options);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("Bot MCP session routing", () => {
  it("offers frontend operations and dispatches with the broker's session identity", async () => {
    await connection(async (client) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("sendToBot");
      expect(names).not.toContain("replyToFrontend");
      await client.callTool({ name: "manageBot", arguments: { action: "list" } });
      expect(dispatchBotTool).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "manageBot", { action: "list" });
      const denied = await client.callTool({ name: "replyToFrontend", arguments: {} });
      expect(denied.isError).toBe(true);
      expect(dispatchBotTool).toHaveBeenCalledOnce();
    });
  });
  it("awaits a CLI question response before serializing the MCP result", async () => {
    vi.mocked(dispatchBotTool).mockReturnValueOnce(Promise.resolve({ promptId: "question", status: "answering" }));
    await connection(async (client) => {
      const result = await client.callTool({ name: "manageBot", arguments: { action: "respond", botId: "bot", promptId: "question", optionId: "1" } });
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ promptId: "question", status: "answering" }) }]);
    });
  });
  it("only offers the reply operation to Bots and rejects calls to hidden frontend tools", async () => {
    vi.mocked(isBotSession).mockReturnValue(true);
    await connection(async (client) => {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["replyToFrontend"]);
      for (const name of ["manageBot", "sendToBot", "readBotReplies", "spawnBackgroundChat"]) {
        expect((await client.callTool({ name, arguments: {} })).isError).toBe(true);
      }
      expect(dispatchBotTool).not.toHaveBeenCalled();
    });
  });
  it("preserves the translation-worker and MCP-group gates", async () => {
    for (const options of [{ submitTranslationTool: true }, { group: "render" as const }]) {
      await connection(async (client) => {
        expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("manageBot");
        expect((await client.callTool({ name: "manageBot", arguments: { action: "list" } })).isError).toBe(true);
      }, options);
    }
    expect(dispatchBotTool).not.toHaveBeenCalled();
  });
});
