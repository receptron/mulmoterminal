// The `claude --mcp-config` payload every spawned session carries.
//
// Points claude at the in-process GUI MCP server served over Streamable HTTP. The session id
// rides in the URL path (the MCP server is otherwise stateless), so no env var and no
// subprocess are needed — the agent just calls back into this server.
//
// Pure, with the port and the user's servers passed in: index.ts read both from module state,
// so the precedence rule below could not be tested without booting the server (#548).
import { rewriteLoopbackForDocker } from "../infra/sandbox.js";
import type { UserMcpServer } from "../config/config-schema.js";

export interface McpConfigInput {
  sessionId: string;
  // 127.0.0.1 rather than localhost avoids an IPv6/IPv4 resolution mismatch against the
  // server's listen address.
  host?: string;
  port: string | number;
  // The user's own HTTP MCP servers (Settings).
  userMcpServers: readonly UserMcpServer[];
  // Inside a container the user's loopback URLs have to be rewritten to reach the host.
  sandbox?: boolean;
}

const DEFAULT_HOST = "127.0.0.1";
const GUI_SERVER_ID = "mulmoterminal-gui";

export function mcpConfigJson({ sessionId, host = DEFAULT_HOST, port, userMcpServers, sandbox = false }: McpConfigInput): string {
  const mcpServers: Record<string, { type: string; url: string }> = {};
  // The user's servers go in FIRST so the built-in GUI entry below always wins on a clashing
  // id. sanitizeUserMcpServers already reserves that id; this is defense in depth.
  for (const server of userMcpServers) {
    mcpServers[server.id] = { type: "http", url: sandbox ? rewriteLoopbackForDocker(server.url) : server.url };
  }
  mcpServers[GUI_SERVER_ID] = { type: "http", url: `http://${host}:${port}/api/mcp/${sessionId}` };
  return JSON.stringify({ mcpServers });
}
