// GUI chat-protocol MCP server, built per session and served over HTTP from the
// main mulmoterminal process (see the `/api/mcp/:sessionId` route in server/index.ts).
// Registers one MCP tool per enabled plugin (from server/plugins-registry.js,
// driven by plugins/plugins.json) and acts as a thin bridge to the host routes:
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
// Previously this ran as a per-session stdio subprocess that claude spawned via
// --mcp-config. It now lives in-process and is exposed over Streamable HTTP so the
// agent can reach it from anywhere (host or, later, a Docker sandbox) without us
// shipping the server code + tsx into the agent's environment. The session id and
// the host base URL are passed in by the caller instead of via env.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { toolDefinitions } from "../infra/plugins-registry.js";
import { offeredTools, routeToolCall, SUBMIT_TRANSLATION_TOOL_NAME } from "./tool-gate.js";
import { toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";
import { interpretToolEnvelope } from "./tool-envelope.js";
import { isRecord } from "../../common/isRecord.js";
import type { GuiCallRecorder } from "./gui-call-history.js";
import { messageOf } from "../errors.js";
import { SESSION_HEADER } from "../backends/sessionRelativePath.js";

// Shape of the dispatch route's response (POST /api/plugin/<tool>). `data` gates
// whether a toolResult is published to the GUI; the rest is narration/metadata.

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
}

// The worker-only result tool used by the hidden translation chat (see
// translateViaHiddenChat in server/index.ts). It is NOT a plugin: the worker calls it
// to hand its structured answer straight back, so the broker special-cases it (POST
// to /api/translation/submit WITH the session id) instead of the /api/plugin path.
// Advertised only when `submitTranslationTool` is set, so normal chats never see it.
const SUBMIT_TRANSLATION_TOOL = {
  name: SUBMIT_TRANSLATION_TOOL_NAME,
  description:
    "Report the finished translation. Call this EXACTLY ONCE with a `translations` array of the " +
    "translated strings, in the same order and length as the input. This is the only way to return " +
    "the result — do not print it as text.",
  inputSchema: {
    type: "object",
    properties: { translations: { type: "array", items: { type: "string" } } },
    required: ["translations"],
  },
} as const;

/**
 * Build a fresh GUI MCP server bound to one chat session. Stateless: create one
 * per request (Streamable HTTP in stateless mode forbids reusing a transport, and
 * the server has no per-connection state beyond the captured `sessionId`).
 *
 * @param sessionId  the chat session whose GUI panel should render tool results
 * @param baseUrl    the mulmoterminal host origin to POST plugin dispatch + results to
 * @param opts.submitTranslationTool  expose the worker-only `submitTranslation` tool
 *                                    (set only for hidden translation-worker sessions)
 * @param opts.group  serve only one GROUP of the GUI tools (the `/api/mcp/<group>/<id>` URLs,
 *                    which exist so a directory can enable a subset through Claude Code's own
 *                    per-folder MCP config). Null/absent = every tool, the single view's URL.
 * @param opts.history  feed each call into the tools pane's call history. Set only for agents
 *                      that have no hooks of their own — see mcp/gui-call-history.ts, which
 *                      also explains why claude must NOT get one.
 */
export function buildGuiMcpServer(
  sessionId: string,
  baseUrl: string,
  opts: { submitTranslationTool?: boolean; group?: ToolGroup | null; history?: GuiCallRecorder | null } = {},
): Server {
  const group = opts.group ?? null;
  // The advertised server name follows the id a group is expected to be registered under, so
  // what a user sees in `claude mcp list` matches what they wrote in their own config.
  const serverName = group === null ? "mulmoterminal-gui" : toolGroupServerId(group);
  const server = new Server({ name: serverName, version: "0.0.0" }, { capabilities: { tools: {} } });

  // Both layers of the worker AND group gates live in mcp/tool-gate.ts (pure/tested): the
  // offer is filtered here, and anything outside it that gets named anyway is refused below.
  const isWorker = !!opts.submitTranslationTool;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: offeredTools(isWorker, toolDefinitions, SUBMIT_TRANSLATION_TOOL, group),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const route = routeToolCall(name, isWorker, group);

    // Worker-only result tool: deliver the structured translations back to the
    // waiting request (keyed by session id), bypassing the plugin dispatch path.
    if (route.kind === "submit-translation") {
      await postJson(`${baseUrl}/api/translation/submit`, { sessionId, translations: isRecord(args) ? args.translations : undefined });
      return { content: [{ type: "text", text: "Translation received. You are done." }] };
    }

    // The tools pane's call history, for an agent that cannot report its own (codex, agy).
    // Recorded around the DISPATCH so a slow plugin shows as "running…" while it runs, which
    // is what claude's PreToolUse gives the pane. Null for claude — its hooks already report
    // this same call — and for the hidden translation worker, which has no pane.
    const history = opts.history ?? null;
    const toolUseId = randomUUID();
    const startedAt = Date.now();
    const started = () => history?.start({ toolUseId, toolName: name, toolInput: args });
    const finished = (toolOutput: unknown, status: "completed" | "failed") =>
      history?.end({ toolUseId, toolName: name, toolInput: args, toolOutput, durationMs: Date.now() - startedAt, status });

    if (route.kind === "refused") {
      // Recorded, not skipped: a tool the agent named and was refused is precisely what someone
      // reading the history is looking for.
      started();
      finished(route.message, "failed");
      return { content: [{ type: "text", text: route.message }], isError: true };
    }

    started();
    try {
      // Dispatch to the plugin's server-side handler, then interpret its envelope (tool-envelope.ts).
      // The session header is what lets a route resolve a path argument against the directory
      // this agent is actually running in (backends/sessionRelativePath.ts) — the args alone
      // carry no clue which of the grid's directories the call came from.
      const parsed = await (await postJson(`${baseUrl}/api/plugin/${name}`, args ?? {}, { [SESSION_HEADER]: sessionId })).json();
      const { publish, narration } = interpretToolEnvelope(isRecord(parsed) ? parsed : {});

      // A GUI toolResult, only when there is data to render.
      if (publish) {
        await postJson(`${baseUrl}/api/agent/toolResult`, { sessionId, toolName: name, uuid: randomUUID(), ...publish });
      }
      finished(narration, "completed");
      return { content: [{ type: "text", text: narration }] };
    } catch (err) {
      // The dispatch route answered non-2xx, or its JSON was unreadable. Closing the entry here
      // is the same reason PostToolUseFailure is registered alongside PostToolUse for claude:
      // without it a failed call sits on "running…" for the life of the session. The error still
      // propagates — the SDK turns it into the agent's error response, as before.
      finished(messageOf(err), "failed");
      throw err;
    }
  });

  return server;
}
