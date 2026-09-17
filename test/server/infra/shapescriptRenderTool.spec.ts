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
import { RENDER_BUDGET_MS } from "@mulmoclaude/shapescript-plugin/render";
import { RENDER_SHAPE_SCRIPT, runRenderShapeScript } from "../../../server/infra/shapescript-render-tool.js";
import { makeTempDir } from "../../support/tempDir";

// Module scope, not `beforeAll`: `it.runIf` is evaluated when the file is COLLECTED,
// which happens before any hook runs. Probing in a hook left the flag false at
// collection time and skipped the pixel cases everywhere — silently no coverage,
// which is worse than the CI failure it was meant to fix.
const ws = makeTempDir("mt-render-tool-");
const ARTIFACT = "artifacts/shapes/lamp.shape";
const REPO_REL = "models/bracket.shape";
const CUBE = "cube {\n size 1\n color 0.2 0.6 0.9\n}";

mkdirSync(path.join(ws, "artifacts", "shapes"), { recursive: true });
writeFileSync(path.join(ws, ARTIFACT), CUBE);
mkdirSync(path.join(ws, "models"), { recursive: true });
writeFileSync(path.join(ws, REPO_REL), CUBE);
initArtifactsBackend({ workspace: ws });
resetOpenPathBackend();
initOpenPathBackend({ workspace: ws });

/** What ONE rasterising case is allowed to take: the package's own budget for a render.
 *
 *  Named rather than guessed. This file used to carry `60_000` of its own, chosen when a render
 *  cost about a second here — and that number was a guess about somebody else's work, smaller than
 *  what one render may now legitimately take (`RENDER_BUDGET_MS` covers the browser launch, the page
 *  load and the rasterisation, and the page-load half arrived with
 *  @mulmoclaude/shapescript-plugin 6.2.0). Deriving it means a budget the package raises cannot
 *  leave this file failing cases that were about to succeed. It does not cover the host work either
 *  side — reading the `.shape`, writing the PNG — so it is a budget rather than a proof. */
const CASE_TIMEOUT_MS = RENDER_BUDGET_MS;

/** Whether a render is DEPENDABLE here, which is not the same as possible.
 *
 *  Never on CI, and that is measured rather than preferred. The Windows job is the only CI that can
 *  rasterise at all — `windows-pr.yaml` and `windows-daily.yaml` cache `~/.cache/puppeteer` while
 *  `ci.yml` does not — and it has failed these cases at every budget they have been given: at
 *  Puppeteer's 30s default (#2095), at three attempts of it (#2096: one case passed at 33.7s while
 *  another failed at 93.7s), and at the 60s the upstream fix installed (#2107: two of three cases
 *  over a minute, with the fix in). Everything the render page needs is served from disk, so what
 *  is slow there is Chromium evaluating three.js under software GL on a shared runner with no GPU.
 *  Another number would be chasing it.
 *
 *  So the cases run where the file always said they belong — a developer machine, which is where a
 *  rendering regression would be caught anyway — and every CI job now agrees instead of one of them
 *  disagreeing by accident of a cache. */
const RASTERISES_DEPENDABLY = !process.env.CI;

/** Whether this machine can actually rasterise.
 *
 *  Probed rather than assumed, and the probe CANNOT be allowed to throw. A missing browser answers
 *  `rendered: false`, which is tidy — but a browser that launches and then cannot navigate throws
 *  instead, which is what a loaded Windows runner does. An unguarded probe at module scope took the
 *  whole FILE down with it, including the cases that need no browser at all.
 *
 *  Not probed at all on CI: the probe IS a render, so on the one CI that has a browser it spends a
 *  minute of the job to discover what this file already knows. */
const probe = RASTERISES_DEPENDABLY
  ? await runRenderShapeScript({ script: CUBE, views: "single", width: 160, height: 160 }).catch((err: unknown) => ({
      rendered: false,
      message: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    }))
  : { rendered: false, message: "CI: rasterising cases do not run here (#2107)" };
const canRender = probe.rendered;
if (!canRender) console.warn(`[shapescriptRenderTool.spec] cannot rasterise here — skipping the pixel cases: ${probe.message}`);

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
  // a second render costs another whole Chromium (see CASE_TIMEOUT_MS), and answers nothing the
  // first could not. ABSOLUTE is the point of the path assertion — MulmoTerminal's sessions run in
  // per-project directories, so a workspace-relative answer resolves to nothing from the cwd the
  // agent is in, or worse to a different file that happens to share the name.
  it.runIf(canRender)("renders an inline script and answers with an absolute path under the workspace artifacts", { timeout: CASE_TIMEOUT_MS }, async () => {
    const { message, rendered } = await runRenderShapeScript({ script: CUBE, views: "single", width: 200, height: 200 });
    expect(rendered).toBe(true);
    const file = savedPath(message);
    expect(path.isAbsolute(file)).toBe(true);
    expect(file.startsWith(path.join(ws, "artifacts", "renders"))).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
  });

  it.runIf(canRender)("renders a saved model by its artifact path", { timeout: CASE_TIMEOUT_MS }, async () => {
    const { rendered, message } = await runRenderShapeScript({ path: ARTIFACT, views: "single", width: 200, height: 200 });
    expect(rendered).toBe(true);
    expect(existsSync(savedPath(message))).toBe(true);
  });

  it.runIf(canRender)("renders a .shape outside the artifacts root through byPath", { timeout: CASE_TIMEOUT_MS }, async () => {
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
