// @vitest-environment node
// The registry resolves plugins.json at import time (top-level await), so importing it
// here IS the end-to-end check that every configured package still loads. The factory
// path matters most: @mulmoclaude/google-plugin exports only TOOL_DEFINITION + a
// definePlugin default, so a regression in loadFactoryPackage drops the tool entirely.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";

import { plugins, toolDefinitions, allowedToolNames, mountAllRoutes } from "../../../server/infra/plugins-registry.js";

describe("plugins registry", () => {
  it("normalizes a factory-shaped package into { toolName, definition, execute }", () => {
    const google = plugins.find((plugin) => plugin.toolName === "google");
    expect(google).toBeDefined();
    expect(google?.definition.name).toBe("google");
    expect(typeof google?.execute).toBe("function");
  });

  it("advertises the factory-loaded tool to the MCP broker", () => {
    expect(toolDefinitions.map((definition) => definition.name)).toContain("google");
    expect(allowedToolNames()).toContain("mcp__mulmoterminal-gui__google");
  });

  it("loads every package in plugins.json without a duplicate tool name", () => {
    const names = plugins.map((plugin) => plugin.toolName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("POST /api/plugin/:toolName dispatch", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountAllRoutes(app);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => server?.close());

  // Regression (#748): the dispatch map was a plain object, so an Object.prototype member
  // name resolved to a truthy function and was dispatched as a plugin. A Map returns 404.
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])("404s the prototype-chain name %j instead of dispatching it", async (name) => {
    const res = await fetch(`${base}/api/plugin/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(404);
  });
});
