// Stdio MCP server for the GUI chat protocol spike (Phase I).
//
// Exposes a single tool, `presentMarkdown({ markdown })`. When claude calls it,
// we POST the payload to mulmoterminal's /api/gui route; the server publishes it
// on the "gui" pub/sub channel and the Vue GUI panel renders it. This is the
// transport-agnostic "data channel" the spike is validating end-to-end under an
// interactive PTY (see docs/gui-protocol-spike.md).
//
// Context reaches this subprocess via env (set when the server builds the
// mcp-config), mirroring MulmoClaude's MULMOCLAUDE_CHAT_SESSION_ID:
//   MULMOTERMINAL_SESSION_ID  - the session whose GUI panel should render this
//   MULMOTERMINAL_PORT        - the mulmoterminal HTTP port to POST to
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SESSION_ID = process.env.MULMOTERMINAL_SESSION_ID;
const PORT = process.env.MULMOTERMINAL_PORT || "3456";
const GUI_URL = `http://localhost:${PORT}/api/gui`;

const server = new McpServer({ name: "mulmoterminal-gui", version: "0.0.0" });

server.registerTool(
  "presentMarkdown",
  {
    title: "Present Markdown",
    description:
      "Render markdown in the user's GUI panel (right side), beside the terminal. " +
      "Use this to show formatted content — tables, lists, headings, code — that is " +
      "easier to read rendered than as plain terminal text.",
    inputSchema: { markdown: z.string().describe("The markdown to render in the GUI panel.") },
  },
  async ({ markdown }) => {
    const res = await fetch(GUI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        type: "presentMarkdown",
        data: { markdown },
      }),
    });
    if (!res.ok) {
      throw new Error(`/api/gui responded ${res.status}`);
    }
    return { content: [{ type: "text", text: "Rendered markdown in the GUI panel." }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
