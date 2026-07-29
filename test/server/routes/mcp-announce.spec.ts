// @vitest-environment node
// The announcement every MCP session makes on first contact, and the one thing it must NOT say.
//
// The tools pane asks what a session has while the agent is still being spawned, so its first
// answer is empty; this is what tells it to ask again. The GROUP route announced already, which is
// why the grid was fixed and the single view was not — an all-tools session learns no group, so it
// announced nothing and its pane stayed on the too-early answer for the whole session.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";

// The group route PERSISTS what it learned, under a MULMOTERMINAL_HOME derived from the home
// directory at import time — so point HOME somewhere disposable BEFORE importing, or this spec
// appends test uuids to the developer's own ~/.mulmoterminal (the same reason tool-store.ts takes
// its root as a parameter).
//
// `process.env` is per PROCESS, not per spec file, and vitest reuses a worker for several files.
// Leaving HOME pointed at a directory this file then deletes would hand the next file in the same
// worker a home that does not exist, so it is put back — the module registry is per file, so the
// next file's imports read the restored value.
const HOME = mkdtempSync(path.join(os.tmpdir(), "mt-mcp-announce-"));
const REAL_HOME = process.env.HOME;
process.env.HOME = HOME;
afterAll(() => {
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

const { mountMcpRoutes, TOOL_GROUPS_CHANNEL } = await import("../../../server/routes/mcp-routes.js");

const published: { channel: string; data: Record<string, unknown> }[] = [];
const app = express();
app.use(express.json());
mountMcpRoutes(app, {
  publish: (channel, data) => void published.push({ channel, data: data as Record<string, unknown> }),
  guiCallHistory: () => null,
});

// A tools/list, the cheapest real MCP request: it needs no plugin dispatch, so nothing here
// depends on a running host.
const call = (route: string) =>
  request(app).post(route).set("accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

const announcementsFor = (id: string) => published.filter((p) => p.channel === TOOL_GROUPS_CHANNEL && p.data.sessionId === id);

beforeEach(() => {
  published.length = 0;
});

describe("MCP first-contact announcement", () => {
  it("announces a single-view (all-tools) session, which has no group to announce with", async () => {
    const id = randomUUID();
    await call(`/api/mcp/${id}`);
    expect(announcementsFor(id)).toHaveLength(1);
    // No `groups` key at all. The grid reads that field to decide whether a cell has the Canvas
    // MCP, and an all-tools session genuinely has none to report — sending `[]` would tell a cell
    // that can draw that it cannot.
    expect("groups" in announcementsFor(id)[0].data).toBe(false);
  });

  it("announces once per session, not once per tool call", async () => {
    const id = randomUUID();
    await call(`/api/mcp/${id}`);
    await call(`/api/mcp/${id}`);
    await call(`/api/mcp/${id}`);
    expect(announcementsFor(id)).toHaveLength(1);
  });

  it("still announces the learned groups for a grid cell's group url", async () => {
    const id = randomUUID();
    await call(`/api/mcp/render/${id}`);
    expect(announcementsFor(id).some((p) => Array.isArray(p.data.groups) && (p.data.groups as string[]).includes("render"))).toBe(true);
  });

  it("says nothing for a malformed session id", async () => {
    await call("/api/mcp/not-a-uuid");
    expect(published).toHaveLength(0);
  });
});
