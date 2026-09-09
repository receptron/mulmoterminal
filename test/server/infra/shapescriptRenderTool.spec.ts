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

/** Whether this machine can actually rasterise.
 *
 *  Probed rather than assumed, and the probe CANNOT be allowed to throw. A missing
 *  browser answers `rendered: false`, which is tidy — but a browser that launches and
 *  then cannot navigate throws instead, and on Windows CI that is what happens
 *  (`Navigation timeout of 30000 ms exceeded`). An unguarded probe at module scope
 *  took the whole FILE down with it, including the cases that need no browser at all. */
const probe = await runRenderShapeScript({ script: CUBE, views: "single", width: 160, height: 160 }).catch((err: unknown) => ({
  rendered: false,
  message: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
}));
const canRender = probe.rendered;
if (!canRender) console.warn(`[shapescriptRenderTool.spec] cannot rasterise here — skipping the pixel cases: ${probe.message}`);

/** What ONE rasterising case is allowed to take.
 *
 *  The plugin launches a fresh Chromium per call and closes it again (`render.js`: `launch(...)`
 *  … `finally { close() }`), so each of these pays a cold start plus a software-GL render. That is
 *  ~1s on a developer machine and **over the suite's 15s default on a Windows CI runner**, where
 *  the job then failed about half the time — the same four cases, each at exactly 15,000ms
 *  (#2013's release CI). Elsewhere the probe finds no browser and they never run at all, so this
 *  budget is only ever spent where a render genuinely happens. */
const RENDER_TIMEOUT_MS = 60_000;

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

  // Everything this one render can settle, settled here: a second case asking the same question of
  // a second render costs another whole Chromium (see RENDER_TIMEOUT_MS), and answers nothing the
  // first could not. ABSOLUTE is the point of the path assertion — MulmoTerminal's sessions run in
  // per-project directories, so a workspace-relative answer resolves to nothing from the cwd the
  // agent is in, or worse to a different file that happens to share the name.
  it.runIf(canRender)(
    "renders an inline script and answers with an absolute path under the workspace artifacts",
    async () => {
      const { message, rendered } = await runRenderShapeScript({ script: CUBE, views: "single", width: 200, height: 200 });
      expect(rendered).toBe(true);
      const file = savedPath(message);
      expect(path.isAbsolute(file)).toBe(true);
      expect(file.startsWith(path.join(ws, "artifacts", "renders"))).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    },
    RENDER_TIMEOUT_MS,
  );

  it.runIf(canRender)(
    "renders a saved model by its artifact path",
    async () => {
      const { rendered, message } = await runRenderShapeScript({ path: ARTIFACT, views: "single", width: 200, height: 200 });
      expect(rendered).toBe(true);
      expect(existsSync(savedPath(message))).toBe(true);
    },
    RENDER_TIMEOUT_MS,
  );

  it.runIf(canRender)(
    "renders a .shape outside the artifacts root through byPath",
    async () => {
      const { rendered } = await runRenderShapeScript({ path: REPO_REL, views: "single", width: 200, height: 200 });
      expect(rendered).toBe(true);
    },
    RENDER_TIMEOUT_MS,
  );

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
