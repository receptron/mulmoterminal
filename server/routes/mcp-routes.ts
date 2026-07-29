// The surface the agent's MCP client talks to, and the one endpoint that only exists because
// of it.
//
// /api/mcp/:sessionId is the in-process GUI MCP server over Streamable HTTP; claude (wired up
// by session/mcp-config.ts) POSTs JSON-RPC there. /api/translation/submit is where the hidden
// translation worker reports its answer, through the broker's worker-only submitTranslation
// tool — it is a landing point for that tool and nothing else, which is why it sits with the
// MCP surface rather than with the translation routes (#548).
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Express, Request, Response } from "express";

import { PORT, SESSION_ID_RE } from "../config/env.js";
import { buildGuiMcpServer } from "../mcp/broker.js";
import { translationWorkerIds, markSessionToolGroup, sessionToolGroups } from "../session/registry.js";
import { isToolGroup, type ToolGroup } from "../../common/toolGroups.js";
import { submitTranslation } from "../session/translation-worker.js";
import { translationSubmitOutcome } from "../session/translation-submit.js";

// No SSE stream and no session teardown in stateless mode, so everything but POST is refused.
const rejectNonPost = (_req: Request, res: Response) => res.status(405).set("Allow", "POST").json({ error: "method not allowed" });

// A session's tool groups are LEARNED, and the client cannot predict when: the browser is
// handed the session id before claude is even spawned, so the panel's first question about it
// is normally asked before claude's MCP client has connected. Without a push, that first "no"
// would stand until the user collapsed and re-expanded the cell.
//
// Its own channel rather than the `sessions` one: that channel's consumer guards with
// `"id" in d` and feeds whatever passes to applyActivity, so a foreign message shaped like
// this would be read as an activity update.
export const TOOL_GROUPS_CHANNEL = "tool-groups";

export interface McpRouteDeps {
  publish: (channel: string, data: unknown) => void;
}

export function mountMcpRoutes(app: Express, deps: McpRouteDeps): void {
  // We run in STATELESS mode (sessionIdGenerator: undefined): one fresh Server+transport per
  // request, no session header and no initialize handshake required across requests. The SDK
  // forbids reusing a stateless transport, so it is never cached.
  async function handleMcpRequest(req: Request, res: Response, sessionId: string, group: ToolGroup | null) {
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: "invalid sessionId" });
    }
    // Hidden translation workers (and only they) get the worker-only submitTranslation
    // tool, so a normal chat's tool list stays clean.
    const server = buildGuiMcpServer(sessionId, `http://127.0.0.1:${PORT}`, {
      submitTranslationTool: translationWorkerIds.has(sessionId),
      group,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[mcp] request failed for ${sessionId}:`, err);
      if (!res.headersSent) res.status(500).json({ error: "mcp error" });
    }
  }

  const sseTransports = new Map<string, SSEServerTransport>();

  async function handleSseRequest(req: Request, res: Response, sessionId: string, group: ToolGroup | null) {
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: "invalid sessionId" });
    }
    const server = buildGuiMcpServer(sessionId, `http://127.0.0.1:${PORT}`, {
      submitTranslationTool: translationWorkerIds.has(sessionId),
      group,
    });
    const messageEndpoint = group ? `/api/mcp/sse-messages/${group}/${sessionId}` : `/api/mcp/sse-messages/${sessionId}`;
    const transport = new SSEServerTransport(messageEndpoint, res);
    const key = group ? `${sessionId}:${group}` : sessionId;
    sseTransports.set(key, transport);
    res.on("close", () => {
      sseTransports.delete(key);
      server.close();
    });
    try {
      await server.connect(transport);
    } catch (err) {
      console.error(`[mcp-sse] connection failed for ${sessionId}:`, err);
    }
  }

  async function handleSsePostMessage(req: Request, res: Response, sessionId: string, group: ToolGroup | null) {
    const key = group ? `${sessionId}:${group}` : sessionId;
    const transport = sseTransports.get(key);
    if (!transport) {
      return res.status(400).json({ error: "SSE session not found" });
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error(`[mcp-sse] message failed for ${sessionId}:`, err);
      if (!res.headersSent) res.status(500).json({ error: "mcp sse error" });
    }
  }

  app.get("/api/mcp/sse/:sessionId", (req, res) => handleSseRequest(req, res, req.params.sessionId, null));
  app.post("/api/mcp/sse-messages/:sessionId", (req, res) => handleSsePostMessage(req, res, req.params.sessionId, null));

  app.get("/api/mcp/sse/:group/:sessionId", (req, res) => {
    const { group, sessionId } = req.params;
    if (!isToolGroup(group)) return res.status(404).json({ error: `unknown tool group: ${group}` });
    if (SESSION_ID_RE.test(sessionId) && !sessionToolGroups(sessionId).includes(group)) {
      markSessionToolGroup(sessionId, group);
      deps.publish(TOOL_GROUPS_CHANNEL, { sessionId, groups: sessionToolGroups(sessionId) });
    }
    return handleSseRequest(req, res, sessionId, group);
  });
  app.post("/api/mcp/sse-messages/:group/:sessionId", (req, res) => {
    const { group, sessionId } = req.params;
    if (!isToolGroup(group)) return res.status(404).json({ error: `unknown tool group: ${group}` });
    return handleSsePostMessage(req, res, sessionId, group);
  });

  // The array is handed to the waiting request as-is; translateViaHiddenChat validates it.
  app.post("/api/translation/submit", (req, res) => {
    const { status, body } = translationSubmitOutcome(req.body, (id) => SESSION_ID_RE.test(id), submitTranslation);
    return res.status(status).json(body);
  });
}
