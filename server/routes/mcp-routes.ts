// The surface the agent's MCP client talks to, and the one endpoint that only exists because
// of it.
//
// /api/mcp/:sessionId is the in-process GUI MCP server over Streamable HTTP; claude (wired up
// by session/mcp-config.ts) POSTs JSON-RPC there. /api/translation/submit is where the hidden
// translation worker reports its answer, through the broker's worker-only submitTranslation
// tool — it is a landing point for that tool and nothing else, which is why it sits with the
// MCP surface rather than with the translation routes (#548).
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Express, Request, Response } from "express";

import { PORT, SESSION_ID_RE } from "../config/env.js";
import { buildGuiMcpServer } from "../mcp/broker.js";
import type { GuiCallRecorder } from "../mcp/gui-call-history.js";
import { translationWorkerIds, markSessionToolGroup, sessionToolGroups } from "../session/registry.js";
import { isToolGroup, TOOL_GROUPS, type ToolGroup } from "../../common/toolGroups.js";
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
  /**
   * A recorder for this session's GUI tool calls, or null to record nothing. Resolved per
   * request rather than per session id up front: a session's agent is known only once its PTY
   * exists, and the same id is asked about again on every later call. See mcp/gui-call-history.ts
   * for which agents get one and why claude must not.
   */
  guiCallHistory: (sessionId: string) => GuiCallRecorder | null;
}

// Sessions whose MCP client has made contact, so the announcement below is sent once per session
// rather than on every tool call. In-memory only: after a restart a session announcing itself
// again is exactly right, since the panel it is telling has also just reconnected.
const announcedSessions = new Set<string>();

export function mountMcpRoutes(app: Express, deps: McpRouteDeps): void {
  /**
   * Tell the panel this session's MCP client is up, so anything it asked too early can be re-asked.
   *
   * The pane is handed a session id while the agent is still being spawned, so its first
   * `/api/tools` lands before there is anything to answer with. The GROUP route below already
   * announces (with the groups it just learned) and that fixed the grid; a single-view session
   * connects on the ALL-TOOLS url, learns no group, and so announced nothing — leaving that pane
   * on whatever the too-early answer said for the rest of the session.
   *
   * Deliberately carries NO `groups` field. The grid reads that field to decide whether a cell has
   * the Canvas MCP, and an all-tools session genuinely has no groups to report — sending `[]` would
   * read as "this cell cannot draw" for a session that can. Consumers that need groups ignore a
   * message without them; consumers that only need "ask again" (the tools pane) act on both.
   */
  function announceMcpContact(sessionId: string): void {
    if (announcedSessions.has(sessionId)) return;
    announcedSessions.add(sessionId);
    deps.publish(TOOL_GROUPS_CHANNEL, { sessionId });
  }

  /**
   * Record what reaching us on this URL proves the session can call, and tell the panel — once,
   * on the transition, so the per-request MCP servers don't republish on every tool call.
   *
   * Shared by both routes because the evidence is the same kind: the URL a client connected to.
   * One group for the group URL; every group for the all-tools one.
   */
  function learnToolGroups(sessionId: string, groups: readonly ToolGroup[]): void {
    if (!SESSION_ID_RE.test(sessionId)) return;
    const known = sessionToolGroups(sessionId);
    if (groups.every((group) => known.includes(group))) return;
    for (const group of groups) markSessionToolGroup(sessionId, group);
    deps.publish(TOOL_GROUPS_CHANNEL, { sessionId, groups: sessionToolGroups(sessionId) });
  }

  // We run in STATELESS mode (sessionIdGenerator: undefined): one fresh Server+transport per
  // request, no session header and no initialize handshake required across requests. The SDK
  // forbids reusing a stateless transport, so it is never cached.
  async function handleMcpRequest(req: Request, res: Response, sessionId: string, group: ToolGroup | null) {
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: "invalid sessionId" });
    }
    // Both routes, because both kinds of session are asked about too early. The group route's own
    // announcement below carries the groups it learned; this one only says "I am here".
    announceMcpContact(sessionId);
    // Hidden translation workers (and only they) get the worker-only submitTranslation
    // tool, so a normal chat's tool list stays clean.
    // A translation worker is a hidden claude session with no pane to feed, so it never gets a
    // recorder — asking would only be an extra lookup for a guaranteed null.
    const isWorker = translationWorkerIds.has(sessionId);
    const server = buildGuiMcpServer(sessionId, `http://127.0.0.1:${PORT}`, {
      submitTranslationTool: isWorker,
      group,
      history: isWorker ? null : deps.guiCallHistory(sessionId),
    });
    // No sessionIdGenerator at all is the SDK's stateless mode. Spelling it `undefined` says
    // the same thing to the runtime but not to the type — the option is exact-optional.
    const transport = new StreamableHTTPServerTransport({});
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      // A cast, which this codebase otherwise refuses — and it asserts only what the SDK itself declares.
      // @modelcontextprotocol/sdk@1.30.0 writes `class StreamableHTTPServerTransport implements Transport`,
      // yet types that class's onclose/onerror/onmessage accessors `T | undefined` while Transport spells
      // them `?: T`. Under exactOptionalPropertyTypes the class therefore fails the interface it claims; the
      // sibling WebStandardStreamableHTTPServerTransport declares them correctly, which is what makes this a
      // declaration bug rather than a real mismatch. Upstream issue (open, names this exact workaround):
      // https://github.com/modelcontextprotocol/typescript-sdk/issues/2083 — drop the cast when it lands.
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[mcp] request failed for ${sessionId}:`, err);
      if (!res.headersSent) res.status(500).json({ error: "mcp error" });
    }
  }

  // The ALL-TOOLS surface: a session gets this URL from --mcp-config (spawnClaudePty's
  // attachGuiMcp), never from a user's per-folder config, so connecting here is proof it carries
  // the whole GUI MCP — every group, not none.
  //
  // Recorded rather than left implicit because the answer is read from a place that cannot see
  // how the session was spawned: a chat started programmatically (the collections UI) is spawned
  // with the full MCP and then ADOPTED as a grid cell, so the cell attaches with `?gui=0` and is
  // marked a grid session — at which point "no groups learned" is read as "cannot draw" and the
  // Canvas button is withheld from a session that has every drawing tool there is.
  //
  // Grid cells proper are untouched: without --mcp-config they never reach this URL, and what
  // they can call still comes only from what their directory registered.
  app.post("/api/mcp/:sessionId", (req, res) => {
    learnToolGroups(req.params.sessionId, TOOL_GROUPS);
    return handleMcpRequest(req, res, req.params.sessionId, null);
  });
  app.get("/api/mcp/:sessionId", rejectNonPost);
  app.delete("/api/mcp/:sessionId", rejectNonPost);

  // One URL per tool group. Registered SECOND so the single-segment route above keeps its
  // meaning ("every tool") — Express matches on segment count, so the two never collide.
  //
  // An unknown group is a 404 rather than a fallback to the all-tools surface: a typo in a
  // user's own `.mcp.json` must not silently hand a directory every tool there is.
  app.post("/api/mcp/:group/:sessionId", (req, res) => {
    const { group, sessionId } = req.params;
    if (!isToolGroup(group)) return res.status(404).json({ error: `unknown tool group: ${group}` });
    // Reaching us here IS the evidence that this session has the group — nothing else tells
    // us, since the registration lives in the user's own MCP config. Marked before the request
    // is served so a panel asking right after the first ListTools already sees it.
    learnToolGroups(sessionId, [group]);
    return handleMcpRequest(req, res, sessionId, group);
  });
  app.get("/api/mcp/:group/:sessionId", rejectNonPost);
  app.delete("/api/mcp/:group/:sessionId", rejectNonPost);

  // The array is handed to the waiting request as-is; translateViaHiddenChat validates it.
  app.post("/api/translation/submit", (req, res) => {
    const { status, body } = translationSubmitOutcome(req.body, (id) => SESSION_ID_RE.test(id), submitTranslation);
    return res.status(status).json(body);
  });
}
