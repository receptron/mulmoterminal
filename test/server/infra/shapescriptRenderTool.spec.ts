// @vitest-environment node
//
// The renderShapeScript host tool.
//
// Rasterisation needs a real browser, and CI has none — the Puppeteer download is
// not part of these jobs. So the suite PROBES once and splits: the argument
// contract, the path routing and the refusals always run, while the cases that
// need pixels run only where a browser exists (a developer machine, which is
// where a rendering regression would be caught anyway). The alternative — assert
// `rendered === true` everywhere — is what failed CI on the first attempt, and
// asserting nothing would let the whole file pass on a host that cannot render.
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { initArtifactsBackend } from "../../../server/backends/artifacts.js";
import { initOpenPathBackend, resetOpenPathBackend } from "../../../server/backends/openPath.js";
import { RENDER_SHAPE_SCRIPT, runRenderShapeScript } from "../../../server/infra/shapescript-render-tool.js";
import { makeTempDir } from "../../support/tempDir";

// Module scope, not `beforeAll`: `it.runIf` is evaluated when the file is COLLECTED,
// which happens before any hook runs. Probing in a hook left the flag false at
// collection time and skipped the pixel cases everywhere — silently no coverage,
// which is worse than the CI failure it was meant to fix.
const ws = makeTempDir("mt-render-tool-");
const ARTIFACT = "artifacts/shapes/lamp.shape";
const REPO_REL = "models/bracket.shape";
const CUBE = "cube { size 1 color 0.2 0.6 0.9 }";

mkdirSync(path.join(ws, "artifacts", "shapes"), { recursive: true });
writeFileSync(path.join(ws, ARTIFACT), CUBE);
mkdirSync(path.join(ws, "models"), { recursive: true });
writeFileSync(path.join(ws, REPO_REL), CUBE);
initArtifactsBackend({ workspace: ws });
resetOpenPathBackend();
initOpenPathBackend({ workspace: ws });

/** Whether this machine can actually rasterise. Probed rather than assumed: the tool
 *  answers `rendered: false` with install guidance when Puppeteer has no browser,
 *  which is a legitimate outcome and not a test failure. */
const probe = await runRenderShapeScript({ script: CUBE, views: "single", width: 160, height: 160 });
const canRender = probe.rendered;
if (!canRender) console.warn(`[shapescriptRenderTool.spec] no browser here — skipping the pixel cases: ${probe.message}`);

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

  it.runIf(canRender)("renders an inline script and saves it under the workspace artifacts", async () => {
    const { message, rendered } = await runRenderShapeScript({ script: CUBE, views: "single", width: 200, height: 200 });
    expect(rendered).toBe(true);
    const file = savedPath(message);
    expect(file.startsWith(path.join(ws, "artifacts", "renders"))).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
  });

  // ABSOLUTE is the point: MulmoTerminal's sessions run in per-project directories,
  // so a workspace-relative path resolves to nothing from the cwd the agent is in —
  // or, worse, to a different file that happens to share the name.
  it.runIf(canRender)("answers with an absolute path, because sessions do not run in the workspace", async () => {
    const { message } = await runRenderShapeScript({ script: CUBE, views: "single", width: 200, height: 200 });
    expect(path.isAbsolute(savedPath(message))).toBe(true);
  });

  it.runIf(canRender)("renders a saved model by its artifact path", async () => {
    const { rendered, message } = await runRenderShapeScript({ path: ARTIFACT, views: "single", width: 200, height: 200 });
    expect(rendered).toBe(true);
    expect(existsSync(savedPath(message))).toBe(true);
  });

  it.runIf(canRender)("renders a .shape outside the artifacts root through byPath", async () => {
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
