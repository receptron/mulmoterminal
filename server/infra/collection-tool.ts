// MCP tool binding for the shared `manageCollection` agent data plane
// (@mulmoclaude/core/collection/server — the same engine MulmoClaude's host
// binds). Registered as a HOST TOOL (see host-tools.ts + the
// /api/plugin/manageCollection dispatch route in server/index.ts): the engine
// runs in-process against the shared workspace, so unlike manageAccounting
// there is no passthrough router — the route calls the handler directly.
//
// MulmoTerminal's deps binding:
//   - workspaceRoot: omitted — the engine falls back to the collection host
//     configured at boot (initCollectionsBackend → configureCollectionHost),
//     the same root every collection REST route uses.
//   - bundledHelpsDir: workspace-setup's helpsAssetDir, so `schemaDocs`
//     serves the bundled collection-authoring reference even when the
//     workspace has no config/helps copy (only managed workspaces are seeded).
//   - refreshAfterWrite: omitted — MulmoTerminal has no schema-driven side
//     state to refresh after putSchema (MulmoClaude refreshes its scheduled
//     skills / user tasks); collection watchers pick up the write via fs events.
import type { ToolDefinition } from "gui-chat-protocol";
import { makeManageCollectionTool } from "@mulmoclaude/core/collection/server";
import { helpsAssetDir } from "@mulmoclaude/core/workspace-setup";

const tool = makeManageCollectionTool({ bundledHelpsDir: helpsAssetDir });

/** The bound handler the dispatch route calls. Returns the tool's narration
 *  string (JSON for the read/write actions) — no GUI `data`, matching
 *  MulmoClaude where manageCollection results narrate to claude only. */
export const manageCollectionHandler = tool.handler;

/** gui-chat-protocol shape of the core tool's MCP definition — the same
 *  inputSchema→parameters / prompt-folding adaptation loadServerToolPackage
 *  applies to XTool-shaped server tools. The core definition types its
 *  inputSchema loosely (`type: string`); the runtime value is the literal
 *  "object" the protocol type wants, so re-stamp it. */
export const MANAGE_COLLECTION: ToolDefinition = {
  type: "function",
  name: tool.definition.name,
  description: tool.definition.description,
  prompt: tool.prompt,
  parameters: { ...tool.definition.inputSchema, type: "object" } as ToolDefinition["parameters"],
};
