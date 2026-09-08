// Server-side plugin registry. Loads two kinds of GUI-protocol plugins and
// normalizes them into one shape the MCP broker and the dispatch route consume:
//
//   - packages: gui-chat-protocol plugin packages (e.g. @gui-chat-plugin/markdown).
//       Their core entry exports a ToolPluginCore { toolDefinition, execute } plus
//       TOOL_DEFINITION. These are shared VERBATIM with MulmoClaude — one source of
//       truth, loaded as an npm dependency. Newer ones (e.g. @mulmoclaude/google-plugin)
//       instead default-export a `definePlugin` FACTORY taking a PluginRuntime; both
//       shapes are packages, and loadPackage picks the right adapter per module.
//   - servers:  server-only MCP-tool packages (e.g. @mulmoclaude/x-plugin) that
//       export one or more `XTool`-shaped objects ({ definition, requiredEnv,
//       prompt, handler }) — pure agent tools with NO GUI view. Each is adapted
//       into the same normalized shape; a tool whose `requiredEnv` is unmet is
//       dropped at load so claude never sees a tool it cannot run (mirrors
//       MulmoClaude's isMcpToolEnabled gating).
//   - local:    in-tree plugins under plugins/<name>/ whose definition.js exports a
//       gui-chat-protocol ToolDefinition and whose server.js exports execute(args).
//       These are pre-extraction holdovers that migrate to packages over time.
//
// Both the main server (which mounts the dispatch route) and the MCP broker (which
// registers the tools) import this, so the GUI tool set is driven entirely by
// plugins.json.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { Express } from "express";
import { isPluginFactory } from "gui-chat-protocol";
import type { FileOps, PluginRuntime, PluginFactoryResult, ToolDefinition } from "gui-chat-protocol";
import { generateImage } from "../backends/image-gen.js";
import { markdownHostApp } from "../backends/markdown.js";
import { artifactsFileOps } from "../backends/artifacts.js";
import { htmlByPath, shapeScriptByPath } from "../backends/openPath.js";
import { createPluginRuntime } from "./pluginRuntime.js";
import { resolvePluginTools } from "./tool-precedence.js";
import { HOST_TOOL_DEFINITIONS } from "./host-tools.js";
import { groupOfTool, toolGroupServerId, GUI_SERVER_ID, AUTO_ALLOWED_TOOLS, NEVER_AUTO_APPROVED_TOOLS, type ToolGroup } from "../../common/toolGroups.js";
import { missingRequiredEnv, soleExecutor, isExecutor } from "./server-tool-load.js";
import { isRecord } from "../../common/isRecord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ../.. climbs server/infra/ → server/ → package root, where plugins/ lives.
const PLUGINS_DIR = path.join(__dirname, "..", "..", "plugins");

// The gui-chat-protocol ToolContext.app — host-provided backends a plugin's
// execute() may call (e.g. @mulmochat-plugin/generate-image calls
// `context.app.generateImage(prompt)`). Plugins that don't need a backend simply
// ignore it. Passed to every package's execute below.
// Spread the markdown host app (loadDoc/saveDoc/saveNewDoc/marpThemes/exportPdf/
// fillImages) alongside generateImage — context.app is a shared capability bag;
// each plugin's execute uses only what it needs. The markdown backend is
// initialised with the workspace + pubsub at boot (server/index.ts).
const APP_CONTEXT = { generateImage, ...markdownHostApp };

// The gui-chat-protocol ToolContext.files — generic file capabilities keyed by
// area. `artifacts` is the shared, user-browsable output area (rooted at
// <workspace>/artifacts), used by @mulmoclaude/chart-plugin's executeChart to
// persist the chart document. Plugins that don't write artifacts ignore it.
//
// `byPath` is the uncontained one — a file the tool call NAMED, anywhere on disk —
// and it is EXTENSION-SCOPED, so it cannot be shared: handing presentShapeScript the
// html-scoped one would refuse every `.shape` it was pointed at, and widening one
// object to every extension would let each tool open the others' files. So the
// context is built per tool, which is the shape MulmoClaude has always had (it
// assembles one per route) and which this file's previous comment predicted would be
// needed the moment a second plugin wanted `byPath`. shapescript-plugin 1.1.0 is that
// second plugin.
//
// A tool with no entry gets `artifacts` alone. That is the right default rather than
// an oversight: a plugin that never takes a `path` argument has no use for byPath,
// and the ones that do have to opt in HERE, where the extension is chosen.
const BY_PATH_BY_TOOL: Readonly<Record<string, FileOps>> = {
  presentHtml: htmlByPath,
  presentShapeScript: shapeScriptByPath,
};

function filesContextFor(toolName: string): { artifacts: FileOps; byPath?: FileOps } {
  const byPath = Object.prototype.hasOwnProperty.call(BY_PATH_BY_TOOL, toolName) ? BY_PATH_BY_TOOL[toolName] : undefined;
  return byPath ? { artifacts: artifactsFileOps, byPath } : { artifacts: artifactsFileOps };
}

// The normalized shape every loader below answers with, and the only one the broker and the
// dispatch route consume. Stated once because four loaders have to agree on it.
interface LoadedPlugin {
  toolName: string;
  definition: ToolDefinition;
  execute: (args?: unknown) => unknown;
}

// The three required fields of a gui-chat-protocol ToolDefinition. A guard rather than a cast:
// a definition arrives from an imported module, so nothing here has checked it before now.
const isToolDefinition = (value: unknown): value is ToolDefinition =>
  isRecord(value) && value.type === "function" && typeof value.name === "string" && typeof value.description === "string";

// plugins.json entries are module specifiers, so a non-string is a config error rather than a
// plugin. Dropped, but never in silence: it would otherwise vanish between the file and the tool
// list with nothing anywhere to read.
function moduleNames(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  const names = value.filter((entry): entry is string => typeof entry === "string");
  if (names.length !== value.length) {
    console.warn(`[plugins] plugins.json "${field}": ignored ${value.length - names.length} non-string entries`);
  }
  return names;
}

function loadConfig() {
  const raw = fs.readFileSync(path.join(PLUGINS_DIR, "plugins.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  const fields = isRecord(parsed) ? parsed : {};
  return {
    packages: moduleNames(fields.packages, "packages"),
    servers: moduleNames(fields.servers, "servers"),
    local: moduleNames(fields.local, "local"),
  };
}

// A FACTORY-style gui-chat-protocol package (authored with `definePlugin`, e.g.
// @mulmoclaude/google-plugin): the default export takes a PluginRuntime and returns
// `{ TOOL_DEFINITION, async <TOOL_DEFINITION.name>(args) }` — the executor is a method
// named after the tool, so there's no bare `execute` for loadPackage to find. Build the
// package's scoped runtime, call the factory once at load, and adapt the result.
// `isPluginFactory` is the protocol's own detector, so this tracks the spec.
function loadFactoryPackage(name: string, factory: (runtime: PluginRuntime) => PluginFactoryResult): LoadedPlugin {
  const plugin = factory(createPluginRuntime(name));
  const definition = plugin.TOOL_DEFINITION;
  const execute = plugin[definition.name];
  if (!isExecutor(execute)) {
    throw new Error(`Plugin factory "${name}" exports no "${definition.name}" executor matching its TOOL_DEFINITION.`);
  }
  // A factory's executor takes only args — its host capabilities came from the runtime.
  return { toolName: definition.name, definition, execute: (args?: unknown) => execute(args ?? {}) };
}

// A gui-chat-protocol package. The core entry exposes TOOL_DEFINITION (a JSON-schema
// ToolDefinition) and a ToolPluginCore whose execute(context, args) returns the
// result envelope. We invoke it in-process when the broker dispatches, passing the
// host backends as context.app (image generation, etc.). Factory-style packages are
// a different shape entirely, so they branch off to loadFactoryPackage first.
async function loadPackage(name: string): Promise<LoadedPlugin> {
  const mod: unknown = await import(name);
  if (!isRecord(mod)) throw new Error(`Package "${name}" did not resolve to a module namespace object.`);
  if (isPluginFactory(mod.default)) return loadFactoryPackage(name, mod.default);
  const core = isRecord(mod.pluginCore) ? mod.pluginCore : undefined;
  const definition = mod.TOOL_DEFINITION ?? core?.toolDefinition;
  // Some packages (e.g. @mulmoclaude/core/collection) export their executor under
  // a descriptive name like `executePresentCollection` rather than a bare `execute`,
  // and ship no `pluginCore` on the core entry (their origin host registers the tool
  // as a built-in). Fall back to a sole `execute*` function export so such packages
  // still load without hardcoding their name.
  const execute = core?.execute ?? mod.execute ?? soleExecutor(mod);
  if (!isToolDefinition(definition) || !isExecutor(execute)) {
    throw new Error(`Package "${name}" is not a gui-chat-protocol plugin (missing TOOL_DEFINITION/execute).`);
  }
  return {
    toolName: definition.name,
    definition,
    execute: (args?: unknown) => execute({ app: APP_CONTEXT, files: filesContextFor(definition.name) }, args ?? {}),
  };
}

// An `XTool`-shaped server-only tool (see @mulmoclaude/x-plugin): a JSON-schema
// definition + an async handler returning a plain string for claude, with no GUI
// data. `requiredEnv` lists env vars (e.g. X_BEARER_TOKEN) the handler needs.
interface ServerTool {
  definition: { name: string; description: string; inputSchema: ToolDefinition["parameters"] };
  requiredEnv?: string[];
  prompt?: string;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

// An XTool's inputSchema IS the JSON-schema object a ToolDefinition carries as `parameters`, and
// it is adapted into one below — so its shape is checked here rather than assumed there. Only the
// container is: every JsonSchemaProperty field is optional, and the property values are forwarded
// to the broker without this file ever reading inside them.
const isInputSchema = (value: unknown): value is ToolDefinition["parameters"] =>
  isRecord(value) &&
  value.type === "object" &&
  isRecord(value.properties) &&
  Object.values(value.properties).every(isRecord) &&
  Array.isArray(value.required) &&
  value.required.every((key) => typeof key === "string");

function isServerTool(value: unknown): value is ServerTool {
  if (!isRecord(value)) return false;
  const definition = value.definition;
  return (
    isRecord(definition) &&
    typeof definition.name === "string" &&
    typeof definition.description === "string" &&
    isInputSchema(definition.inputSchema) &&
    typeof value.handler === "function"
  );
}

// A server-only tool package. Import it, pick every XTool-shaped export, and adapt
// each into the normalized { toolName, definition, execute } shape. Tools whose
// requiredEnv is not fully satisfied are dropped (and logged) so they never reach
// the broker's tool list. The handler's string result becomes the envelope
// `message`; with no `data`, the broker publishes nothing to the GUI.
async function loadServerToolPackage(name: string): Promise<LoadedPlugin[]> {
  const mod: unknown = await import(name);
  const tools = Object.values(isRecord(mod) ? mod : {}).filter(isServerTool);
  if (tools.length === 0) {
    throw new Error(`Server-tool package "${name}" exports no XTool-shaped tools ({ definition, handler }).`);
  }
  return tools
    .filter((tool) => {
      const missing = missingRequiredEnv(tool.requiredEnv, process.env);
      if (missing.length > 0) {
        console.warn(`[plugins] skipping server tool "${tool.definition.name}" — missing env: ${missing.join(", ")}`);
        return false;
      }
      return true;
    })
    .map((tool) => ({
      toolName: tool.definition.name,
      // Adapt the XTool definition into a gui-chat-protocol ToolDefinition the
      // broker lists: inputSchema -> parameters; prompt folds into the description.
      // Spread rather than assigned: both are optional on ToolDefinition, and under
      // exactOptionalPropertyTypes writing `prompt: undefined` is a present key holding
      // undefined — a different thing from an absent one, and not what the broker is given.
      definition: {
        type: "function" as const,
        name: tool.definition.name,
        description: tool.definition.description,
        ...(tool.prompt === undefined ? {} : { prompt: tool.prompt }),
        ...(tool.definition.inputSchema === undefined ? {} : { parameters: tool.definition.inputSchema }),
      },
      execute: async (args?: unknown) => ({ message: await tool.handler(isRecord(args) ? args : {}) }),
    }));
}

// A local plugin: definition.js exports TOOL_DEFINITION (a gui-chat-protocol
// ToolDefinition), server.js exports execute(args).
async function loadLocal(name: string): Promise<LoadedPlugin> {
  const dir = path.join(PLUGINS_DIR, name);
  const importJs = async (file: string): Promise<Record<string, unknown>> => {
    const mod: unknown = await import(pathToFileURL(path.join(dir, file)).href);
    return isRecord(mod) ? mod : {};
  };
  const [definitionModule, serverModule] = await Promise.all([importJs("definition.js"), importJs("server.js")]);
  const definition = definitionModule.TOOL_DEFINITION;
  const execute = serverModule.execute;
  if (!isToolDefinition(definition) || !isExecutor(execute)) {
    throw new Error(`Local plugin "${name}" must export TOOL_DEFINITION and execute().`);
  }
  return { toolName: definition.name, definition, execute: (args?: unknown) => execute(args ?? {}) };
}

const config = loadConfig();
// Top-level await: the loaded set is ready by the time importers use it. Server-tool
// packages can contribute more than one tool each, so flatten their results.
export const plugins = [
  ...(await Promise.all(config.packages.map(loadPackage))),
  ...(await Promise.all(config.servers.map(loadServerToolPackage))).flat(),
  ...(await Promise.all(config.local.map(loadLocal))),
];

// A name can be claimed twice; tool-precedence.ts decides who keeps it, so the advertised
// list below is built from the same answer the dispatch map is. Both collisions used to pass
// silently, with the list describing one implementation while another ran.
const { dispatched: dispatchablePlugins, collisions } = resolvePluginTools(
  plugins,
  (p) => p.toolName,
  HOST_TOOL_DEFINITIONS.map((d) => d.name),
);
for (const { name, shadowedBy } of collisions) {
  const keeper = shadowedBy === "host" ? "a built-in host tool" : "the last plugin to declare it";
  console.warn(`[plugins] tool "${name}" is declared more than once — ${keeper} keeps the name; the other is not offered`);
}

// A Map, not a plain object: object index access reads through the prototype chain, so a
// tool name like "constructor" or "__proto__" would resolve to Object.prototype's member
// (a truthy function) and get dispatched as if it were a real plugin. Map.get only ever
// returns own entries.
const byName = new Map(dispatchablePlugins.map((p) => [p.toolName, p]));

// MCP tool definitions the broker registers — gui-chat-protocol ToolDefinitions
// ({ name, description, prompt?, parameters }), one per DISPATCHABLE plugin plus the
// built-in host tools (which the server dispatches itself; see host-tools.ts).
export const toolDefinitions = [...dispatchablePlugins.map((p) => p.definition), ...HOST_TOOL_DEFINITIONS];

// JSON-serializable summaries (no schema) for the GUI's tools pane.
export const toolSummaries = toolDefinitions.map((d) => ({
  toolName: d.name,
  title: d.name,
  description: d.description,
}));

// Mount the uniform dispatch route. The MCP broker POSTs a tool's args to
// /api/plugin/<toolName>; the plugin's execute returns the result envelope
// { data?, jsonData?, message?, instructions?, title? } the broker forwards.
export function mountAllRoutes(app: Express) {
  app.post("/api/plugin/:toolName", async (req, res) => {
    const plugin = byName.get(req.params.toolName);
    if (!plugin) return res.status(404).json({ error: `Unknown tool: ${req.params.toolName}` });
    try {
      res.json(await plugin.execute(req.body));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// Fully-qualified MCP tool names for claude's --allowedTools (auto-run, no prompt).
// Includes host tools so they run without a permission prompt too.
//
// `group` names one of the per-group URLs instead of the all-tools surface. The prefix has to
// change with it: --allowedTools matches on `mcp__<server id>__<tool>`, and a group is
// registered under its own id (common/toolGroups.ts). Passing a group the session may not
// even have registered is harmless — an allowlist entry for a server that isn't there matches
// nothing, which is exactly what lets the grid pass `render` unconditionally.
export function allowedToolNames(group: ToolGroup | null = null) {
  const serverId = group === null ? GUI_SERVER_ID : toolGroupServerId(group);
  const defs = group === null ? toolDefinitions : toolDefinitions.filter((d) => groupOfTool(d.name) === group);
  // NEVER_AUTO_APPROVED_TOOLS is filtered HERE rather than at the call site because this function
  // is the auto-approval list itself: a second caller that forgot the filter would re-open the
  // hole silently. Filtering here does not take the tool away — availability comes from
  // --mcp-config, which still carries it. It only means the agent has to ask.
  return defs.filter((d) => !NEVER_AUTO_APPROVED_TOOLS.includes(d.name)).map((d) => `mcp__${serverId}__${d.name}`);
}

// The fully-qualified names a GRID cell pre-approves: the auto-allowed tools, each under the
// server id of the group it belongs to. Derived per TOOL rather than per group because "which
// tools may this directory reach" and "which may run without asking" are different questions —
// see AUTO_ALLOWED_TOOLS for the one that forces them apart.
export function autoAllowedToolNames() {
  return AUTO_ALLOWED_TOOLS.flatMap((name) => {
    const group = groupOfTool(name);
    return group === null ? [] : [`mcp__${toolGroupServerId(group)}__${name}`];
  });
}
