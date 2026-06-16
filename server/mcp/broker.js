// Stdio MCP broker for the GUI chat protocol. Registers one MCP tool per enabled
// plugin (from server/plugins-registry.js, driven by plugins/plugins.json) and acts
// as a thin HTTP bridge to the main server:
//
//   tool call  ->  POST /api/plugin/<toolName>         (the dispatch route)
//              ->  envelope { data, message, instructions, title? }
//              ->  POST /api/agent/toolResult           (store + publish; data gates it)
//              ->  return message+instructions text to claude
//
// Tools are registered straight from gui-chat-protocol ToolDefinitions: the
// JSON-schema `parameters` is passed through as the MCP inputSchema (no zod). This
// is the same shape MulmoClaude's broker uses (server/agent/mcp-server.ts), and it
// is why we drive the low-level Server API directly instead of McpServer.registerTool
// (which expects a zod raw shape) — so a shared plugin package's JSON-schema
// definition becomes an MCP tool without translation.
//
// The form round-trip is NOT a blocking call: the user's answer comes back by being
// typed into the PTY (see the GUI panel / form view), so every tool returns at once.
//
// Context reaches this subprocess via env (set when the server builds the mcp-config):
//   MULMOTERMINAL_SESSION_ID  - the session whose GUI panel should render this
//   MULMOTERMINAL_PORT        - the mulmoterminal HTTP port to POST to
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { toolDefinitions } from "../plugins-registry.js";

const SESSION_ID = process.env.MULMOTERMINAL_SESSION_ID;
const PORT = process.env.MULMOTERMINAL_PORT || "3456";
const BASE_URL = `http://localhost:${PORT}`;

const server = new Server(
  { name: "mulmoterminal-gui", version: "0.0.0" },
  { capabilities: { tools: {} } }
);

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
}

// A ToolDefinition's optional `prompt` is host-injected usage guidance that isn't
// part of the JSON-schema sent to the model; fold it into the description so claude
// still sees it (MulmoClaude does the same).
function describe(def) {
  return [def.description, def.prompt].filter(Boolean).join("\n\n");
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions.map((def) => ({
    name: def.name,
    description: describe(def),
    inputSchema: def.parameters ?? { type: "object", properties: {} },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // 1. Dispatch to the plugin's server-side handler.
  const envelope = await (await postJson(`${BASE_URL}/api/plugin/${name}`, args ?? {})).json();

  // 2. Publish a toolResult to the GUI — only when there is data to render.
  if (envelope.data !== undefined) {
    await postJson(`${BASE_URL}/api/agent/toolResult`, {
      sessionId: SESSION_ID,
      toolName: name,
      uuid: randomUUID(),
      title: envelope.title,
      data: envelope.data,
      jsonData: envelope.jsonData ?? envelope.data,
      message: envelope.message,
    });
  }

  // 3. Return the narration to claude.
  const parts = [envelope.message, envelope.instructions].filter(Boolean);
  return { content: [{ type: "text", text: parts.length ? parts.join("\n") : "Done" }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
