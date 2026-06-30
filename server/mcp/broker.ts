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
import { toolDefinitions } from "../plugins-registry.js";

// Shape of the dispatch route's response (POST /api/plugin/<tool>). `data` gates
// whether a toolResult is published to the GUI; the rest is narration/metadata.
interface ToolEnvelope {
  data?: unknown;
  title?: unknown;
  jsonData?: unknown;
  message?: unknown;
  instructions?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function postJson(url: string, body: unknown) {
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
function describe(def: { description?: string; prompt?: string }) {
  return [def.description, def.prompt].filter(Boolean).join("\n\n");
}

// The worker-only result tool used by the hidden translation chat (see
// translateViaHiddenChat in server/index.ts). It is NOT a plugin: the worker calls it
// to hand its structured answer straight back, so the broker special-cases it (POST
// to /api/translation/submit WITH the session id) instead of the /api/plugin path.
// Advertised only when `submitTranslationTool` is set, so normal chats never see it.
const SUBMIT_TRANSLATION_TOOL = {
  name: "submitTranslation",
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
 */
export function buildGuiMcpServer(sessionId: string, baseUrl: string, opts: { submitTranslationTool?: boolean } = {}): Server {
  const server = new Server({ name: "mulmoterminal-gui", version: "0.0.0" }, { capabilities: { tools: {} } });

  // A hidden translation worker processes UNTRUSTED sentence content with its tools
  // auto-allowed, so a prompt-injected string must not be able to reach the regular
  // GUI/plugin tools. Such sessions are therefore exposed ONLY submitTranslation —
  // every other tool is hidden AND refused below (defense in depth).
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.submitTranslationTool
      ? [SUBMIT_TRANSLATION_TOOL]
      : toolDefinitions.map((def) => ({
          name: def.name,
          description: describe(def),
          inputSchema: def.parameters ?? { type: "object", properties: {} },
        })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Worker-only result tool: deliver the structured translations back to the
    // waiting request (keyed by session id), bypassing the plugin dispatch path.
    if (name === SUBMIT_TRANSLATION_TOOL.name) {
      await postJson(`${baseUrl}/api/translation/submit`, { sessionId, translations: isRecord(args) ? args.translations : undefined });
      return { content: [{ type: "text", text: "Translation received. You are done." }] };
    }

    // Translation workers may call NOTHING else — refuse any other tool even if the
    // model is steered toward it by injected sentence content.
    if (opts.submitTranslationTool) {
      return { content: [{ type: "text", text: `Tool "${name}" is not available; call submitTranslation with the translations.` }], isError: true };
    }

    // 1. Dispatch to the plugin's server-side handler.
    const parsed = await (await postJson(`${baseUrl}/api/plugin/${name}`, args ?? {})).json();
    const envelope: ToolEnvelope = isRecord(parsed) ? parsed : {};

    // 2. Publish a toolResult to the GUI — only when there is data to render.
    if (envelope.data !== undefined) {
      await postJson(`${baseUrl}/api/agent/toolResult`, {
        sessionId,
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

  return server;
}
