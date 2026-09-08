// Host tool: `renderShapeScript` — rasterise a ShapeScript model to a PNG the
// AGENT can look at, so it can judge its own model before showing it to anyone.
//
// The tool itself lives in `@mulmoclaude/shapescript-plugin/render`: the schema,
// the defaults, the four-view sheet and the sentence naming the file are shared
// with MulmoClaude, because those are the parts a MODEL sees and two copies of
// them drift without anyone noticing. This module supplies the two things that
// are genuinely MulmoTerminal's — where a `.shape` is read from, and where the
// image goes.
//
// A HOST tool rather than a plugins.json entry (like manageCollection and
// manageSharedApp) because it needs server internals a plugin is not handed: the
// session's own directory, and the workspace artifacts root.
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  executeRenderShapeScript,
  RENDER_SHAPE_SCRIPT_DESCRIPTION,
  RENDER_SHAPE_SCRIPT_PROMPT,
  RENDER_SHAPE_SCRIPT_SCHEMA,
  RENDER_SHAPE_SCRIPT_TOOL_NAME,
} from "@mulmoclaude/shapescript-plugin/render";
import { isShapeArtifactPath, isPresentableShapePath, toArtifactsRelative } from "@mulmoclaude/shapescript-plugin";
import type { ToolDefinition } from "gui-chat-protocol";
import { artifactsFileOps, artifactsRoot } from "../backends/artifacts.js";
import { shapeScriptByPath } from "../backends/openPath.js";

/** Where a render lands, under the workspace artifacts root. Its own directory
 *  rather than beside the models: a `.shape` is a source the user edits, a PNG
 *  is a by-product regenerated on demand, and mixing them makes the shapes
 *  directory unbrowsable. */
const RENDERS_DIR = "renders";

export const RENDER_SHAPE_SCRIPT: ToolDefinition = {
  type: "function",
  name: RENDER_SHAPE_SCRIPT_TOOL_NAME,
  description: RENDER_SHAPE_SCRIPT_DESCRIPTION,
  prompt: RENDER_SHAPE_SCRIPT_PROMPT,
  parameters: RENDER_SHAPE_SCRIPT_SCHEMA,
};

/** Read the source a `path` argument names, through whichever capability owns
 *  it — the artifacts root for a model this app saved, `shapeScriptByPath` for
 *  any other `.shape` on disk. The same routing `presentShapeScript` uses, so
 *  the two tools accept exactly the same paths. */
async function readShape(filePath: string): Promise<string> {
  if (isShapeArtifactPath(filePath)) return artifactsFileOps.read(toArtifactsRelative(filePath));
  if (!isPresentableShapePath(filePath)) {
    throw new Error("`path` must name a .shape file, without `.` / `..` segments");
  }
  return shapeScriptByPath.read(filePath);
}

/** Save the sheet and answer with the path the AGENT should read.
 *
 *  ABSOLUTE, unlike MulmoClaude's relative answer, and that is the whole reason
 *  the package leaves this to the host: MulmoTerminal's sessions run in
 *  per-project directories, so a workspace-relative path resolves to nothing
 *  from the cwd the agent is actually in — or worse, to a different file. */
async function saveRender(base64: string): Promise<string> {
  const name = `${randomBytes(8).toString("hex")}.png`;
  const rel = path.posix.join(RENDERS_DIR, name);
  await artifactsFileOps.write(rel, Buffer.from(base64, "base64"));
  return path.join(artifactsRoot(), RENDERS_DIR, name);
}

/** Run one call. Returns the sentence the agent reads; `rendered` says whether
 *  an image was actually produced, which is the difference between a saved sheet
 *  and a host with no usable browser. */
export async function runRenderShapeScript(args: Record<string, unknown>): Promise<{ message: string; rendered: boolean }> {
  return executeRenderShapeScript(
    {
      readShape,
      saveImage: saveRender,
      onWarning: (message) => console.warn(`[renderShapeScript] ${message}`),
    },
    args,
  );
}
