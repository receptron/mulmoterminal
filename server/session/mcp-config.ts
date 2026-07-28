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
import { toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";

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

// The counterpart for GRID cells, which are handed no --mcp-config at all: their GUI tools
// come from the user's OWN per-folder MCP config (`claude mcp add -s local`, `.mcp.json`),
// where the URL is a static string and cannot carry a session id. Claude Code expands
// `${VAR}` in an MCP url at connect time, so the two moving parts ride in the environment:
//
//   "url": "http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/render/${MULMOTERMINAL_SESSION_ID}"
//
// Set on every claude spawn, not just grid ones — the single view carries its own config and
// simply never reads these, and a session that starts in one view is not worth special-casing.
export function guiMcpEnv(sessionId: string, port: string | number): Record<string, string> {
  return { MULMOTERMINAL_PORT: String(port), MULMOTERMINAL_SESSION_ID: sessionId };
}

// The same two surfaces, spelled for CODEX, which takes them as `-c mcp_servers.<id>.url=` at
// spawn instead of reading a config file. It has no `${VAR}` expansion, so unlike the template
// above these are resolved here — which is possible precisely because they are built per spawn.
//
// The GROUPS are the directory's, read from Claude Code's config by the caller: one switch in the
// launcher, both agents. A grid cell whose directory registered nothing gets an empty list and
// therefore no GUI tools, which is what it had before.
export function codexGuiMcpServers({
  sessionId,
  host = DEFAULT_HOST,
  port,
  groups,
  allTools,
}: {
  sessionId: string;
  host?: string;
  port: string | number;
  groups: readonly ToolGroup[];
  /** The single view, which carries every tool on one URL rather than a URL per group. */
  allTools: boolean;
}): { id: string; url: string }[] {
  const base = `http://${host}:${port}/api/mcp`;
  if (allTools) return [{ id: GUI_SERVER_ID, url: `${base}/${sessionId}` }];
  return groups.map((group) => ({ id: toolGroupServerId(group), url: `${base}/${group}/${sessionId}` }));
}

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
