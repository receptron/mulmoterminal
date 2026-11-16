// @vitest-environment node
// The registry resolves plugins.json at import time (top-level await), so importing it
// here IS the end-to-end check that every configured package still loads. The factory
// path matters most: @mulmoclaude/google-plugin exports only TOOL_DEFINITION + a
// definePlugin default, so a regression in loadFactoryPackage drops the tool entirely.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";

import { appRequest } from "../../../helpers/appRequest.js";
import { plugins, toolDefinitions, allowedToolNames, autoAllowedToolNames, mountAllRoutes } from "../../../../server/infra/tools/plugins-registry.js";
import { initArtifactsBackend } from "../../../../server/backends/plugins/artifacts.js";

describe("plugins registry", () => {
  it("normalizes a factory-shaped package into { toolName, definition, execute }", () => {
    const google = plugins.find((plugin) => plugin.toolName === "google");
    expect(google).toBeDefined();
    expect(google?.definition.name).toBe("google");
    expect(typeof google?.execute).toBe("function");
  });

  it("advertises the factory-loaded tool to the MCP broker", () => {
    expect(toolDefinitions.map((definition) => definition.name)).toContain("google");
    expect(allowedToolNames()).toContain("mcp__mt__google");
  });

  it("loads the spreadsheet package and auto-approves it like the other render tools", () => {
    expect(plugins.map((plugin) => plugin.toolName)).toContain("presentSpreadsheet");
    expect(allowedToolNames()).toContain("mcp__mt__presentSpreadsheet");
  });

  // presentBrep is auto-approved by the owner's decision, although its script is code run in
  // this process (common/toolGroups.ts says why). Pinned so a change to that is a decision made
  // there, and not a side effect of reordering a list.
  it("loads the brep package and auto-approves it in the workspace and in a cell", () => {
    expect(plugins.map((plugin) => plugin.toolName)).toContain("presentBrep");
    expect(allowedToolNames()).toContain("mcp__mt__presentBrep");
    expect(autoAllowedToolNames()).toContain("mcp__mulmoterminal-render__presentBrep");
  });

  it("loads every package in plugins.json without a duplicate tool name", () => {
    const names = plugins.map((plugin) => plugin.toolName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("POST /api/plugin/:toolName dispatch", () => {
  const app = express();
  app.use(express.json());
  mountAllRoutes(app);
  const request = appRequest(app);

  // The spreadsheet View's dispatch reaches the package's own execute on this route, which
  // routes by `kind` and refuses any path outside artifacts/spreadsheets/ before touching files.
  it("routes a spreadsheet dispatch to the package, which refuses a path outside artifacts/spreadsheets/", async () => {
    const res = await request("/api/plugin/presentSpreadsheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "loadSpreadsheet", path: "artifacts/html/page.json" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "path must be a .json file under artifacts/spreadsheets/" });
  });

  // presentBrep end to end on this route: the package builds the model with the OpenCascade
  // kernel in this process and saves it through `files.artifacts`.
  describe("presentBrep", () => {
    let workspace = "";
    beforeAll(() => {
      workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mt-brep-"));
      initArtifactsBackend({ workspace });
    });
    afterAll(() => fs.rmSync(workspace, { recursive: true, force: true }));

    const build = (script: string) =>
      request("/api/plugin/presentBrep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Plate", script }),
      });

    it("builds a model, saves it under artifacts/brep/ and returns what the View draws", async () => {
      const res = await build("const { makeBaseBox } = replicad;\nfunction main() { return makeBaseBox(40, 20, 5).fillet(1); }");
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      const saved = expect.stringMatching(/^artifacts\/brep\/plate-\d+-[0-9a-f]{8}\./);
      expect(body).toMatchObject({
        message: expect.stringMatching(/^Built "Plate": 40 x 20 x 5 mm/),
        jsonData: { files: { script: saved, step: saved, stl: saved, views: saved } },
        // The exports behind the View's download buttons.
        data: { downloads: { name: expect.any(String), step: expect.any(String), stl: expect.any(String), views: expect.any(String) } },
      });
      // They go to the View only: the agent is not sent three files of base64.
      expect(body).not.toHaveProperty("jsonData.downloads");
      const written = fs.readdirSync(path.join(workspace, "artifacts", "brep"));
      expect(written.map((name) => name.slice(name.indexOf("."))).sort()).toEqual([".replicad.js", ".step", ".stl", ".svg"]);
    });

    it("returns a failed build as a diagnostic with its line, and no card", async () => {
      const res = await build("const { makeBaseBox } = replicad;\nfunction main() {\n  return makeBaseBox(40, 20, 5).fillet(3);\n}");
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      expect(body).toMatchObject({ jsonData: { error: { code: "INVALID_RESULT", line: 3 } } });
      expect(body).not.toHaveProperty("data");
    });
  });

  // Regression (#748): the dispatch map was a plain object, so an Object.prototype member
  // name resolved to a truthy function and was dispatched as a plugin. A Map returns 404.
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])("404s the prototype-chain name %j instead of dispatching it", async (name) => {
    const res = await request(`/api/plugin/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(404);
  });
});
