// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { initCollectionsBackend, mountCollectionRoutes } from "./collections.js";

// A minimal project-scope collection skill + one record + one read-only custom
// view, laid out exactly where the engine's discovery looks (matching the shared
// path layout initCollectionsBackend configures):
//   <ws>/.claude/skills/testcol/schema.json   — the collection schema
//   <ws>/data/testcol/items/item1.json        — one record (dataPath)
//   <ws>/data/skills/testcol/views/v1.html    — the custom view (project staging)
const SCHEMA = {
  title: "Test Collection",
  icon: "star",
  dataPath: "data/testcol/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    name: { type: "string", label: "Name" },
  },
  views: [{ id: "v1", file: "views/v1.html", label: "Custom", capabilities: ["read"] }],
};

let server: Server;
let base: string;

beforeAll(async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "mt-col-"));
  mkdirSync(path.join(ws, ".claude", "skills", "testcol"), { recursive: true });
  writeFileSync(path.join(ws, ".claude", "skills", "testcol", "schema.json"), JSON.stringify(SCHEMA));
  mkdirSync(path.join(ws, "data", "testcol", "items"), { recursive: true });
  writeFileSync(path.join(ws, "data", "testcol", "items", "item1.json"), JSON.stringify({ id: "item1", name: "Foo" }));
  mkdirSync(path.join(ws, "data", "skills", "testcol", "views"), { recursive: true });
  writeFileSync(path.join(ws, "data", "skills", "testcol", "views", "v1.html"), "<head></head><body>view</body>");

  // Point the (singleton) collection host at the fixture. vitest isolates modules
  // per test file, so this configure is fresh for this worker.
  initCollectionsBackend({ workspace: ws });

  const app = express();
  app.use(express.json());
  mountCollectionRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server?.close();
});

describe("GET /api/collections/list", () => {
  it("lists the fixture collection", async () => {
    const res = await fetch(`${base}/api/collections/list`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collections: Array<{ slug: string; title: string; source: string }> };
    const testcol = body.collections.find((c) => c.slug === "testcol");
    expect(testcol).toMatchObject({ slug: "testcol", title: "Test Collection", source: "project" });
  });
});

describe("GET /api/collections/:slug/detail", () => {
  it("returns the schema + records", async () => {
    const res = await fetch(`${base}/api/collections/testcol/detail`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collection: { slug: string }; items: Array<{ id: string; name: string }> };
    expect(body.collection.slug).toBe("testcol");
    expect(body.items).toEqual([{ id: "item1", name: "Foo" }]);
  });

  it("404s for a missing slug", async () => {
    expect((await fetch(`${base}/api/collections/nope/detail`)).status).toBe(404);
  });
});

describe("custom view routes", () => {
  it("mints a read-only token (write clamped off)", async () => {
    const res = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; dataUrl: string; capabilities: string[] };
    expect(body.capabilities).toEqual(["read"]);
    expect(body.dataUrl).toBe("/api/collections/testcol/view-data");
    expect(typeof body.token).toBe("string");
  });

  it("400s when viewId is missing", async () => {
    const res = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("404s view-file for an unknown view id", async () => {
    expect((await fetch(`${base}/api/collections/testcol/view-file?id=nope`)).status).toBe(404);
  });

  it("serves view-file HTML with sandbox + nosniff hardening", async () => {
    const res = await fetch(`${base}/api/collections/testcol/view-file?id=v1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("view");
  });

  it("401s view-data without a token", async () => {
    expect((await fetch(`${base}/api/collections/testcol/view-data`)).status).toBe(401);
  });

  it("serves view-data records with a valid token", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v1" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/testcol/view-data`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id)).toEqual(["item1"]);
  });
});
