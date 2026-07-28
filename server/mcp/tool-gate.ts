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
// The GROUP gate below is the same two-layer shape for a different reason. A group URL
// (`/api/mcp/render/:id`) exists so a directory can switch a SUBSET of the GUI tools on
// through Claude Code's own per-folder MCP config; a session that reached us through it must
// not be able to call outside its group by naming a tool it was never offered — same
// assumption, same second layer.
//
// Split out of broker.ts because both rules previously lived inside MCP request handlers,
// reachable only by standing up a server and speaking JSON-RPC to it — so neither had a
// test (#611 A1).
import { groupOfTool, type ToolGroup } from "../../common/toolGroups.js";

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

// `group` null means the all-tools surface (the single view's URL, unchanged). A group filters
// the offer down to the tools classified into it — and an UNCLASSIFIED tool is in no group, so
// it never reaches a group URL (see common/toolGroups.ts for why that direction is deliberate).
export function offeredTools(
  isTranslationWorker: boolean,
  plugins: readonly PluginToolDefinition[],
  workerTool: OfferedTool,
  group: ToolGroup | null = null,
): OfferedTool[] {
  if (isTranslationWorker) return [workerTool];
  const offered = group === null ? plugins : plugins.filter((def) => groupOfTool(def.name) === group);
  return offered.map((def) => ({ name: def.name, description: describeTool(def), inputSchema: def.parameters ?? NO_PARAMETERS }));
}

export type ToolRoute =
  | { kind: "submit-translation" }
  | { kind: "refused"; message: string }
  // Hand off to the plugin dispatch route.
  | { kind: "dispatch" };

export function routeToolCall(name: string, isTranslationWorker: boolean, group: ToolGroup | null = null): ToolRoute {
  const isWorkerTool = name === SUBMIT_TRANSLATION_TOOL_NAME;
  if (isTranslationWorker) {
    if (isWorkerTool) return { kind: "submit-translation" };
    return { kind: "refused", message: `Tool "${name}" is not available; call submitTranslation with the translations.` };
  }
  // The hand-off is the worker's, and an ordinary session is never offered it. Naming it
  // anyway is refused rather than dispatched: what stops it today is that the session has no
  // translation pending, which is a 404 from another module rather than a decision made here
  // — and the layer above already assumes a model can name a tool it was never shown.
  if (isWorkerTool) return { kind: "refused", message: `Tool "${name}" is not available.` };
  // Second layer of the group gate. Refused, not dispatched: the dispatch route would happily
  // run any registered plugin, so "we never offered it" is not a control.
  if (group !== null && groupOfTool(name) !== group) {
    return { kind: "refused", message: `Tool "${name}" is not available on the "${group}" tool group.` };
  }
  return { kind: "dispatch" };
}
