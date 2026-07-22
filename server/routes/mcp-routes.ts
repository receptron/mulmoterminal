// The surface the agent's MCP client talks to, and the one endpoint that only exists because
// of it.
//
// /api/mcp/:sessionId is the in-process GUI MCP server over Streamable HTTP; claude (wired up
// by session/mcp-config.ts) POSTs JSON-RPC there. /api/translation/submit is where the hidden
// translation worker reports its answer, through the broker's worker-only submitTranslation
// tool — it is a landing point for that tool and nothing else, which is why it sits with the
// MCP surface rather than with the translation routes (#548).
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, Request, Response } from "express";

import { PORT, SESSION_ID_RE } from "../config/env.js";
import { buildGuiMcpServer } from "../mcp/broker.js";
import { translationWorkerIds } from "../session/registry.js";
import { submitTranslation } from "../session/translation-worker.js";
import { translationSubmitOutcome } from "../session/translation-submit.js";

// No SSE stream and no session teardown in stateless mode, so everything but POST is refused.
const rejectNonPost = (_req: Request, res: Response) => res.status(405).set("Allow", "POST").json({ error: "method not allowed" });

export function mountMcpRoutes(app: Express): void {
  // We run in STATELESS mode (sessionIdGenerator: undefined): one fresh Server+transport per
  // request, no session header and no initialize handshake required across requests. The SDK
  // forbids reusing a stateless transport, so it is never cached.
  app.post("/api/mcp/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: "invalid sessionId" });
    }
    // Hidden translation workers (and only they) get the worker-only submitTranslation
    // tool, so a normal chat's tool list stays clean.
    const server = buildGuiMcpServer(sessionId, `http://127.0.0.1:${PORT}`, { submitTranslationTool: translationWorkerIds.has(sessionId) });
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
  });
  app.get("/api/mcp/:sessionId", rejectNonPost);
  app.delete("/api/mcp/:sessionId", rejectNonPost);

  // The array is handed to the waiting request as-is; translateViaHiddenChat validates it.
  app.post("/api/translation/submit", (req, res) => {
    const { status, body } = translationSubmitOutcome(req.body, (id) => SESSION_ID_RE.test(id), submitTranslation);
    return res.status(status).json(body);
  });
}
