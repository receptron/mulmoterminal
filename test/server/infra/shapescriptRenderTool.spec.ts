// @vitest-environment node
//
// The renderShapeScript host tool. Rasterisation itself needs a real browser, so
// what is asserted here is everything around it: which paths it will read, that
// the answer is ABSOLUTE (the reason the package leaves saving to the host), and
// that the image really lands under the workspace artifacts root.
import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { initArtifactsBackend } from "../../../server/backends/artifacts.js";
import { initOpenPathBackend, resetOpenPathBackend } from "../../../server/backends/openPath.js";
import { RENDER_SHAPE_SCRIPT, runRenderShapeScript } from "../../../server/infra/shapescript-render-tool.js";
import { makeTempDir } from "../../support/tempDir";

let ws: string;
const ARTIFACT = "artifacts/shapes/lamp.shape";
const REPO_REL = "models/bracket.shape";
const CUBE = "cube { size 1 color 0.2 0.6 0.9 }";

beforeAll(() => {
  ws = makeTempDir("mt-render-tool-");
  mkdirSync(path.join(ws, "artifacts", "shapes"), { recursive: true });
  writeFileSync(path.join(ws, ARTIFACT), CUBE);
  mkdirSync(path.join(ws, "models"), { recursive: true });
  writeFileSync(path.join(ws, REPO_REL), CUBE);
  initArtifactsBackend({ workspace: ws });
  resetOpenPathBackend();
  initOpenPathBackend({ workspace: ws });
});

const savedPath = (message: string): string => {
  const match = /Saved render to (\S+)/.exec(message);
  if (!match?.[1]) throw new Error(`no saved path in: ${message}`);
  return match[1];
};

describe("renderShapeScript host tool", () => {
  it("is offered with the shared contract, not a local copy of it", () => {
    // The description and schema come from the package so the two hosts cannot
    // describe the same tool differently to a model.
    expect(RENDER_SHAPE_SCRIPT.name).toBe("renderShapeScript");
    expect(RENDER_SHAPE_SCRIPT.description).toContain("four camera angles");
    expect(Object.keys(RENDER_SHAPE_SCRIPT.parameters?.properties ?? {})).toEqual(
      expect.arrayContaining(["script", "path", "azimuth", "elevation", "zoom", "views", "projection", "width", "height"]),
    );
  });

  it("renders an inline script and saves it under the workspace artifacts", async () => {
    const { message, rendered } = await runRenderShapeScript({ script: CUBE, views: "single", width: 200, height: 200 });
    expect(rendered).toBe(true);
    const file = savedPath(message);
    expect(file.startsWith(path.join(ws, "artifacts", "renders"))).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
  });

  // ABSOLUTE is the point: MulmoTerminal's sessions run in per-project directories,
  // so a workspace-relative path resolves to nothing from the cwd the agent is in —
  // or, worse, to a different file that happens to share the name.
  it("answers with an absolute path, because sessions do not run in the workspace", async () => {
    const { message } = await runRenderShapeScript({ script: CUBE, views: "single", width: 200, height: 200 });
    expect(path.isAbsolute(savedPath(message))).toBe(true);
  });

  it("renders a saved model by its artifact path", async () => {
    const { rendered, message } = await runRenderShapeScript({ path: ARTIFACT, views: "single", width: 200, height: 200 });
    expect(rendered).toBe(true);
    expect(existsSync(savedPath(message))).toBe(true);
  });

  it("renders a .shape outside the artifacts root through byPath", async () => {
    const { rendered } = await runRenderShapeScript({ path: REPO_REL, views: "single", width: 200, height: 200 });
    expect(rendered).toBe(true);
  });

  it("refuses a path that is not a .shape file", async () => {
    await expect(runRenderShapeScript({ path: "notes.txt" })).rejects.toThrow(/must name a .shape file/);
  });

  it("refuses a traversal path", async () => {
    await expect(runRenderShapeScript({ path: "artifacts/shapes/../../secrets.shape" })).rejects.toThrow();
  });

  it("requires one source and refuses both", async () => {
    await expect(runRenderShapeScript({})).rejects.toThrow(/Provide either/);
    await expect(runRenderShapeScript({ script: CUBE, path: ARTIFACT })).rejects.toThrow(/not both/);
  });
});
