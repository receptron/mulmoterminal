// Host tool: `exportShapeScriptUsdz` — write a ShapeScript model out as a USDZ
// file (AR Quick Look on iPhone / iPad / Mac, or any USD viewer).
//
// Everything about the tool lives in `@mulmoclaude/shapescript-plugin`: the
// schema, the description, the export itself, and where under `artifacts/shapes/`
// the file lands. It reaches storage only through the generic gui-chat-protocol
// `files` capability, so this module contributes exactly the pair
// `presentShapeScript` already runs on — the artifacts root and `shapeScriptByPath`
// — and nothing else. Compare MulmoClaude's `server/agent/mcp-tools/exportShapeScriptUsdz.ts`,
// which is the same call against that host's FileOps.
//
// A HOST tool rather than a plugins.json entry for the reason renderShapeScript
// is: it needs the workspace artifacts root, which a plugin is not handed.
import path from "node:path";
import {
  executeExportShapeScriptUsdz,
  EXPORT_USDZ_DESCRIPTION,
  EXPORT_USDZ_PROMPT,
  EXPORT_USDZ_SCHEMA,
  EXPORT_USDZ_TOOL_NAME,
  toArtifactsRelative,
} from "@mulmoclaude/shapescript-plugin";
import type { ToolDefinition } from "gui-chat-protocol";
import { artifactsFileOps, artifactsRoot } from "../backends/artifacts.js";
import { shapeScriptByPath } from "../backends/openPath.js";

export const EXPORT_SHAPE_SCRIPT_USDZ: ToolDefinition = {
  type: "function",
  name: EXPORT_USDZ_TOOL_NAME,
  description: EXPORT_USDZ_DESCRIPTION,
  prompt: EXPORT_USDZ_PROMPT,
  parameters: EXPORT_USDZ_SCHEMA,
};

/** Run one call. Returns the sentence the agent reads and the ABSOLUTE path of
 *  the saved file.
 *
 *  Absolute is a deliberate divergence from MulmoClaude's workspace-relative
 *  answer, for the reason renderShapeScript's is: MulmoTerminal's sessions run in
 *  per-project directories, so `artifacts/shapes/x.usdz` resolves to nothing from
 *  the cwd the agent is actually in — or to a different file that shares the name.
 *  The package's message is rewritten rather than appended to, so the agent sees
 *  one path, not two. */
export async function runExportShapeScriptUsdz(args: Record<string, unknown>): Promise<{ message: string; filePath: string }> {
  const { filePath, bytes } = await executeExportShapeScriptUsdz({ files: { artifacts: artifactsFileOps, byPath: shapeScriptByPath } }, args);
  const absolute = path.join(artifactsRoot(), ...toArtifactsRelative(filePath).split("/"));
  return {
    message: `Saved USDZ to ${absolute} (${bytes} bytes). Open it with AR Quick Look or any USD viewer.`,
    filePath: absolute,
  };
}
