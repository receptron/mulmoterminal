// Which tools a session may see, and what happens when it calls one.
//
// The rule that matters here is a security boundary, not a convenience. A hidden
// translation worker is fed UNTRUSTED sentence content — collection entries, custom-view
// strings — and its tools are auto-allowed, so it never stops at a permission prompt. A
// string that talks the model into calling `manageCollection` must therefore find nothing
// to call: the worker is offered submitTranslation ALONE, and any other name is refused
// even though it was never advertised. Two layers, because the first one is only a list and
// a model can name a tool it was not shown.
//
// Split out of broker.ts because both rules previously lived inside MCP request handlers,
// reachable only by standing up a server and speaking JSON-RPC to it — so neither had a
// test (#611 A1).

// The shape the broker registers, structurally rather than by import, so this file stays
// free of the plugin registry (and of everything the registry loads).
export interface PluginToolDefinition {
  name: string;
  description?: string;
  prompt?: string;
  parameters?: unknown;
}

export interface OfferedTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export const SUBMIT_TRANSLATION_TOOL_NAME = "submitTranslation";

// An empty object schema, for a definition that declares no parameters — MCP requires the
// field, and omitting it makes some clients drop the tool.
const NO_PARAMETERS = { type: "object", properties: {} };

// A definition's `prompt` is host-injected usage guidance that is not part of the schema the
// model receives, so it is folded into the description or the model never sees it.
export const describeTool = (def: PluginToolDefinition): string => [def.description, def.prompt].filter(Boolean).join("\n\n");

export function offeredTools(isTranslationWorker: boolean, plugins: readonly PluginToolDefinition[], workerTool: OfferedTool): OfferedTool[] {
  if (isTranslationWorker) return [workerTool];
  return plugins.map((def) => ({ name: def.name, description: describeTool(def), inputSchema: def.parameters ?? NO_PARAMETERS }));
}

export type ToolRoute =
  | { kind: "submit-translation" }
  | { kind: "refused"; message: string }
  // Hand off to the plugin dispatch route.
  | { kind: "dispatch" };

export function routeToolCall(name: string, isTranslationWorker: boolean): ToolRoute {
  if (name === SUBMIT_TRANSLATION_TOOL_NAME) return { kind: "submit-translation" };
  if (isTranslationWorker) {
    return { kind: "refused", message: `Tool "${name}" is not available; call submitTranslation with the translations.` };
  }
  return { kind: "dispatch" };
}
