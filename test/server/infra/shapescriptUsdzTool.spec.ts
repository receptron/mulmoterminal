// @vitest-environment node
//
// The exportShapeScriptUsdz host tool. No browser is involved — the exporter is
// three's USDZExporter over the plugin's own geometry — so every case runs
// everywhere, unlike the render tool's pixel cases.
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { initArtifactsBackend } from "../../../server/backends/artifacts.js";
import { initOpenPathBackend, resetOpenPathBackend } from "../../../server/backends/openPath.js";
import { EXPORT_SHAPE_SCRIPT_USDZ, runExportShapeScriptUsdz } from "../../../server/infra/shapescript-usdz-tool.js";
import { makeTempDir } from "../../support/tempDir";

const ws = makeTempDir("mt-usdz-tool-");
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

/** A USDZ is a stored zip: the first four bytes are the local-file-header signature. */
const isZip = (file: string): boolean =>
  readFileSync(file)
    .subarray(0, 4)
    .equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

describe("exportShapeScriptUsdz host tool", () => {
  it("is offered with the shared contract, not a local copy of it", () => {
    expect(EXPORT_SHAPE_SCRIPT_USDZ.name).toBe("exportShapeScriptUsdz");
    expect(EXPORT_SHAPE_SCRIPT_USDZ.description).toContain("USDZ");
    expect(Object.keys(EXPORT_SHAPE_SCRIPT_USDZ.parameters?.properties ?? {})).toEqual(["script", "path", "title"]);
  });

  // ABSOLUTE is the point: sessions run in per-project directories, where the
  // package's workspace-relative answer would name nothing.
  it("exports an inline script beside the models and answers with an absolute path", async () => {
    const { message, filePath } = await runExportShapeScriptUsdz({ script: CUBE, title: "Tiny Cube" });
    expect(path.isAbsolute(filePath)).toBe(true);
    expect(filePath.startsWith(path.join(ws, "artifacts", "shapes"))).toBe(true);
    expect(path.basename(filePath)).toMatch(/^tiny-cube-\d+-[0-9a-f]{8}\.usdz$/);
    expect(message).toContain(filePath);
    // One path, the absolute one — not the package's relative sentence with ours appended.
    expect(message.match(/tiny-cube-\d+-[0-9a-f]{8}\.usdz/g)).toHaveLength(1);
    expect(isZip(filePath)).toBe(true);
  });

  it("exports a saved model by its artifact path and inherits its name", async () => {
    const { filePath } = await runExportShapeScriptUsdz({ path: ARTIFACT });
    expect(path.basename(filePath)).toMatch(/^lamp-\d+-[0-9a-f]{8}\.usdz$/);
    expect(isZip(filePath)).toBe(true);
  });

  it("exports a .shape outside the artifacts root through byPath", async () => {
    const { filePath } = await runExportShapeScriptUsdz({ path: REPO_REL });
    expect(filePath.startsWith(path.join(ws, "artifacts", "shapes"))).toBe(true);
    expect(isZip(filePath)).toBe(true);
  });

  it("refuses a path that is not a .shape file", async () => {
    await expect(runExportShapeScriptUsdz({ path: "notes.txt" })).rejects.toThrow(/must name a .shape file/);
  });

  it("refuses a traversal path", async () => {
    await expect(runExportShapeScriptUsdz({ path: "artifacts/shapes/../../secrets.shape" })).rejects.toThrow();
  });

  it("requires one source and refuses both", async () => {
    await expect(runExportShapeScriptUsdz({})).rejects.toThrow(/Provide either/);
    await expect(runExportShapeScriptUsdz({ script: CUBE, path: ARTIFACT })).rejects.toThrow(/not both/);
  });

  it("reports a ShapeScript error instead of writing a broken file", async () => {
    await expect(runExportShapeScriptUsdz({ script: "cube {" })).rejects.toThrow(/RBRACE/);
  });
});
