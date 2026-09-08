// @vitest-environment node
//
// The presentShapeScript dispatch route — the View's source editor reading and
// writing a `.shape` through loadShape/saveShape. Mirrors html.spec.ts, because the
// route mirrors backends/html.ts: same interception-before-the-catch-all shape, same
// artifacts-plus-byPath capability split, same overwrite-only contract.
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { initArtifactsBackend } from "../../../server/backends/artifacts.js";
import { mountShapeScriptDispatchRoute } from "../../../server/backends/shapescript.js";
import { initOpenPathBackend, resetOpenPathBackend } from "../../../server/backends/openPath.js";
import { makeTempDir } from "../../support/tempDir";

let request: ReturnType<typeof appRequest>;
let ws: string;
const REL = "artifacts/shapes/lamp-1718765432101-abcd1234.shape";
// A model OUTSIDE artifacts/shapes — what presentShapeScript's `path` form is for.
const REPO_REL = "models/bracket.shape";

const ORIGINAL = "cube { size 1 }";
const REPO_SOURCE = "sphere { size 2 }";

beforeAll(() => {
  ws = makeTempDir("mt-shape-");
  mkdirSync(path.join(ws, "artifacts", "shapes"), { recursive: true });
  writeFileSync(path.join(ws, REL), ORIGINAL);
  mkdirSync(path.join(ws, "models"), { recursive: true });
  writeFileSync(path.join(ws, REPO_REL), REPO_SOURCE);
  initArtifactsBackend({ workspace: ws });
  resetOpenPathBackend();
  initOpenPathBackend({ workspace: ws });

  const app = express();
  app.use(express.json());
  mountShapeScriptDispatchRoute(app);
  request = appRequest(app);
});

const dispatch = (body: unknown) =>
  request("/api/plugin/presentShapeScript", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("shapescript dispatch route", () => {
  it("loadShape returns the model's current source", async () => {
    const res = await dispatch({ kind: "loadShape", path: REL });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { script: string }).script).toBe(ORIGINAL);
  });

  it("saveShape overwrites the file in place", async () => {
    const res = await dispatch({ kind: "saveShape", path: REL, script: "cone { size 2 }" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe(REL);
    expect(readFileSync(path.join(ws, REL), "utf8")).toBe("cone { size 2 }");
  });

  // The extension-scoped byPath is why FILES_CONTEXT had to become per-tool: the
  // html-scoped one would refuse this path outright.
  it("loads a model outside artifacts/shapes through byPath", async () => {
    const res = await dispatch({ kind: "loadShape", path: REPO_REL });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { script: string }).script).toBe(REPO_SOURCE);
  });

  it("saveShape overwrites a model outside artifacts/shapes in place", async () => {
    const res = await dispatch({ kind: "saveShape", path: REPO_REL, script: "torus" });
    expect(res.status).toBe(200);
    expect(readFileSync(path.join(ws, REPO_REL), "utf8")).toBe("torus");
  });

  it("rejects a path that does not exist (400, not a 500)", async () => {
    expect((await dispatch({ kind: "loadShape", path: "artifacts/shapes/missing.shape" })).status).toBe(400);
  });

  // Overwrite-only: this channel edits the model on screen, so minting files at
  // caller-chosen paths is a wider capability than it needs.
  it("refuses to CREATE a model the editor was pointed at", async () => {
    const res = await dispatch({ kind: "saveShape", path: "models/brand-new.shape", script: "cube" });
    expect(res.status).toBe(400);
    expect(existsSync(path.join(ws, "models", "brand-new.shape"))).toBe(false);
  });

  // Without `script` as a string, `undefined` would reach the FileOps write and blank
  // the model — the package's own guard is what this asserts is still in the path.
  it("rejects a save payload with no script", async () => {
    const res = await dispatch({ kind: "saveShape", path: REL });
    expect(res.status).toBe(400);
    expect(readFileSync(path.join(ws, REL), "utf8")).not.toBe("");
  });

  it("refuses a traversal path", async () => {
    expect((await dispatch({ kind: "loadShape", path: "artifacts/shapes/../../secrets.shape" })).status).toBe(400);
  });

  it("falls through (no handler → 404) for a tool-call with no kind", async () => {
    // The real server has the generic catch-all after this route; here there's none,
    // so next() lands on Express's 404 — proving the tool-call path isn't intercepted.
    expect((await dispatch({ title: "t", script: "cube" })).status).toBe(404);
  });
});
