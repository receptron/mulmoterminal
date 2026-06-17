// Server-side plugin registry. Loads two kinds of GUI-protocol plugins and
// normalizes them into one shape the MCP broker and the dispatch route consume:
//
//   - packages: gui-chat-protocol plugin packages (e.g. @gui-chat-plugin/markdown).
//       Their core entry exports a ToolPluginCore { toolDefinition, execute } plus
//       TOOL_DEFINITION. These are shared VERBATIM with MulmoClaude — one source of
//       truth, loaded as an npm dependency.
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
import { generateImage } from "./backends/image-gen.js";
import { markdownHostApp } from "./backends/markdown.js";
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

function loadConfig() {
  const raw = fs.readFileSync(path.join(PLUGINS_DIR, "plugins.json"), "utf8");
  const parsed = JSON.parse(raw);
  return {
    packages: Array.isArray(parsed.packages) ? parsed.packages : [],
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
  const execute = mod.pluginCore?.execute ?? mod.execute;
  if (!definition || typeof execute !== "function") {
    throw new Error(`Package "${name}" is not a gui-chat-protocol plugin (missing TOOL_DEFINITION/execute).`);
  }
  return { toolName: definition.name, definition, execute: (args?: unknown) => execute({ app: APP_CONTEXT }, args ?? {}) };
}

// A local plugin: definition.js exports TOOL_DEFINITION (a gui-chat-protocol
// ToolDefinition), server.js exports execute(args).
async function loadLocal(name: string) {
  const dir = path.join(PLUGINS_DIR, name);
  const importJs = (file: string) => import(pathToFileURL(path.join(dir, file)).href);
  const [{ TOOL_DEFINITION }, { execute }] = await Promise.all([
    importJs("definition.js"),
    importJs("server.js"),
  ]);
  if (!TOOL_DEFINITION || typeof execute !== "function") {
    throw new Error(`Local plugin "${name}" must export TOOL_DEFINITION and execute().`);
  }
  return { toolName: TOOL_DEFINITION.name, definition: TOOL_DEFINITION, execute: (args?: unknown) => execute(args ?? {}) };
}

const config = loadConfig();
// Top-level await: the loaded set is ready by the time importers use it.
export const plugins = [
  ...(await Promise.all(config.packages.map(loadPackage))),
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
