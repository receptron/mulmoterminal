// Server-side plugin registry. Reads the configuration data (plugins/plugins.json)
// and loads each enabled plugin's server halves (meta.js, definition.js, server.js).
// Both the main server (server/index.js) and the MCP broker (server/mcp/broker.js)
// import this, so the set of GUI tools is driven entirely by the config file.
//
// Mirrors MulmoClaude's role-gated plugin loading (server/agent/activeTools.ts),
// minus the codegen barrels: here the config is a plain JSON list.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.join(__dirname, "..", "plugins");

const MCP_SERVER_NAME = "mulmoterminal-gui";

function loadConfig() {
  const raw = fs.readFileSync(path.join(PLUGINS_DIR, "plugins.json"), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.enabled)) {
    throw new Error("plugins.json must have an `enabled` array.");
  }
  return parsed.enabled;
}

async function loadPlugin(name) {
  const dir = path.join(PLUGINS_DIR, name);
  const importJs = (file) => import(pathToFileURL(path.join(dir, file)).href);
  const [{ META }, { DEFINITION }, { handlers }] = await Promise.all([
    importJs("meta.js"),
    importJs("definition.js"),
    importJs("server.js"),
  ]);
  return { name, meta: META, definition: DEFINITION, handlers };
}

// Top-level await: the loaded set is ready by the time importers use it.
export const plugins = await Promise.all(loadConfig().map(loadPlugin));

// MCP tool definitions the broker registers (one per enabled plugin).
export const toolDefinitions = plugins.map((p) => ({
  toolName: p.meta.toolName,
  ...p.definition,
}));

// toolName -> meta, so the broker can resolve a call to its REST dispatch route.
export const metas = Object.fromEntries(plugins.map((p) => [p.meta.toolName, p.meta]));

// JSON-serializable summaries (no zod inputSchema) for the GUI's tools pane.
export const toolSummaries = plugins.map((p) => ({
  toolName: p.meta.toolName,
  title: p.definition.title,
  description: p.definition.description,
}));

// Mount each enabled plugin's REST routes under /api/<apiNamespace>. The MCP
// broker POSTs tool args here and gets back the result envelope.
export function mountAllRoutes(app) {
  for (const plugin of plugins) {
    for (const [key, route] of Object.entries(plugin.meta.apiRoutes)) {
      const url = `/api/${plugin.meta.apiNamespace}${route.path}`;
      const method = route.method.toLowerCase();
      app[method](url, (req, res) => {
        try {
          res.json(plugin.handlers[key](req.body));
        } catch (e) {
          res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
        }
      });
    }
  }
}

// Fully-qualified MCP tool names for claude's --allowedTools (auto-run, no prompt).
export function allowedToolNames() {
  return plugins.map((p) => `mcp__${MCP_SERVER_NAME}__${p.meta.toolName}`);
}
