// Server-side plugin registry. Loads two kinds of GUI-protocol plugins and
// normalizes them into one shape the MCP broker and the dispatch route consume:
//
//   - packages: gui-chat-protocol plugin packages (e.g. @gui-chat-plugin/markdown).
//       Their core entry exports a ToolPluginCore { toolDefinition, execute } plus
//       TOOL_DEFINITION. These are shared VERBATIM with MulmoClaude — one source of
//       truth, loaded as an npm dependency.
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
import { generateImage } from "../backends/image-gen.js";
import { markdownHostApp } from "../backends/markdown.js";
import { artifactsFileOps } from "../backends/artifacts.js";
import { HOST_TOOL_DEFINITIONS } from "./host-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.join(__dirname, "..", "plugins");

const MCP_SERVER_NAME = "mulmoterminal-gui";

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
const FILES_CONTEXT = { artifacts: artifactsFileOps };

function loadConfig() {
  const raw = fs.readFileSync(path.join(PLUGINS_DIR, "plugins.json"), "utf8");
  const parsed = JSON.parse(raw);
  return {
    packages: Array.isArray(parsed.packages) ? parsed.packages : [],
    servers: Array.isArray(parsed.servers) ? parsed.servers : [],
    local: Array.isArray(parsed.local) ? parsed.local : [],
  };
}

// A gui-chat-protocol package. The core entry exposes TOOL_DEFINITION (a JSON-schema
// ToolDefinition) and a ToolPluginCore whose execute(context, args) returns the
// result envelope. We invoke it in-process when the broker dispatches, passing the
// host backends as context.app (image generation, etc.).
async function loadPackage(name: string) {
  const mod = await import(name);
  const definition = mod.TOOL_DEFINITION ?? mod.pluginCore?.toolDefinition;
  // Some packages (e.g. @mulmoclaude/core/collection) export their executor under
  // a descriptive name like `executePresentCollection` rather than a bare `execute`,
  // and ship no `pluginCore` on the core entry (their origin host registers the tool
  // as a built-in). Fall back to a sole `execute*` function export so such packages
  // still load without hardcoding their name.
  const soleExecuteStar = (() => {
    const fns = Object.entries(mod).filter(([key, val]) => key.startsWith("execute") && typeof val === "function");
    return fns.length === 1 ? (fns[0][1] as (...args: unknown[]) => unknown) : undefined;
  })();
  const execute = mod.pluginCore?.execute ?? mod.execute ?? soleExecuteStar;
  if (!definition || typeof execute !== "function") {
    throw new Error(`Package "${name}" is not a gui-chat-protocol plugin (missing TOOL_DEFINITION/execute).`);
  }
  return { toolName: definition.name, definition, execute: (args?: unknown) => execute({ app: APP_CONTEXT, files: FILES_CONTEXT }, args ?? {}) };
}

// An `XTool`-shaped server-only tool (see @mulmoclaude/x-plugin): a JSON-schema
// definition + an async handler returning a plain string for claude, with no GUI
// data. `requiredEnv` lists env vars (e.g. X_BEARER_TOKEN) the handler needs.
interface ServerTool {
  definition: { name: string; description: string; inputSchema: object };
  requiredEnv?: string[];
  prompt?: string;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

function isServerTool(value: unknown): value is ServerTool {
  if (typeof value !== "object" || value === null) return false;
  const tool = value as Partial<ServerTool>;
  return typeof tool.definition?.name === "string" && typeof tool.handler === "function";
}

// A server-only tool package. Import it, pick every XTool-shaped export, and adapt
// each into the normalized { toolName, definition, execute } shape. Tools whose
// requiredEnv is not fully satisfied are dropped (and logged) so they never reach
// the broker's tool list. The handler's string result becomes the envelope
// `message`; with no `data`, the broker publishes nothing to the GUI.
async function loadServerToolPackage(name: string) {
  const mod = await import(name);
  const tools = Object.values(mod).filter(isServerTool);
  if (tools.length === 0) {
    throw new Error(`Server-tool package "${name}" exports no XTool-shaped tools ({ definition, handler }).`);
  }
  return tools
    .filter((tool) => {
      const missing = (tool.requiredEnv ?? []).filter((key) => !process.env[key]);
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
      definition: {
        type: "function" as const,
        name: tool.definition.name,
        description: tool.definition.description,
        prompt: tool.prompt,
        parameters: tool.definition.inputSchema,
      },
      execute: async (args?: unknown) => ({ message: await tool.handler((args as Record<string, unknown>) ?? {}) }),
    }));
}

// A local plugin: definition.js exports TOOL_DEFINITION (a gui-chat-protocol
// ToolDefinition), server.js exports execute(args).
async function loadLocal(name: string) {
  const dir = path.join(PLUGINS_DIR, name);
  const importJs = (file: string) => import(pathToFileURL(path.join(dir, file)).href);
  const [{ TOOL_DEFINITION }, { execute }] = await Promise.all([importJs("definition.js"), importJs("server.js")]);
  if (!TOOL_DEFINITION || typeof execute !== "function") {
    throw new Error(`Local plugin "${name}" must export TOOL_DEFINITION and execute().`);
  }
  return { toolName: TOOL_DEFINITION.name, definition: TOOL_DEFINITION, execute: (args?: unknown) => execute(args ?? {}) };
}

const config = loadConfig();
// Top-level await: the loaded set is ready by the time importers use it. Server-tool
// packages can contribute more than one tool each, so flatten their results.
export const plugins = [
  ...(await Promise.all(config.packages.map(loadPackage))),
  ...(await Promise.all(config.servers.map(loadServerToolPackage))).flat(),
  ...(await Promise.all(config.local.map(loadLocal))),
];

const byName = Object.fromEntries(plugins.map((p) => [p.toolName, p]));

// MCP tool definitions the broker registers — gui-chat-protocol ToolDefinitions
// ({ name, description, prompt?, parameters }), one per enabled plugin plus the
// built-in host tools (which the server dispatches itself; see host-tools.ts).
export const toolDefinitions = [...plugins.map((p) => p.definition), ...HOST_TOOL_DEFINITIONS];

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
    const plugin = byName[req.params.toolName];
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
export function allowedToolNames() {
  return toolDefinitions.map((d) => `mcp__${MCP_SERVER_NAME}__${d.name}`);
}
