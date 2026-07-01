// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { initCollectionsBackend, mountCollectionRoutes } from "./collections.js";
import { listRegistry, importRegistry } from "@mulmoclaude/core/collection/registry/server";

// The registry engine fetches remote index.json / bundles — mock it so the route
// tests run offline and we can assert the host glue (status passthrough, args).
vi.mock("@mulmoclaude/core/collection/registry/server", () => ({
  listRegistry: vi.fn(),
  importRegistry: vi.fn(),
}));

// Keep the real collection engine (loadCollection, discovery, CRUD) but stub the two
// filesystem-destructive deletes so route tests don't archive/remove the shared
// fixture — we assert the route glue (status mapping + refusal passthrough).
import { deleteCollection, deleteCustomView } from "@mulmoclaude/core/collection/server";
vi.mock("@mulmoclaude/core/collection/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mulmoclaude/core/collection/server")>()),
  deleteCollection: vi.fn(),
  deleteCustomView: vi.fn(),
}));

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
  views: [
    { id: "v1", file: "views/v1.html", label: "Custom", capabilities: ["read"] },
    { id: "v2", file: "views/v2.html", label: "Editable", capabilities: ["read", "write"] },
  ],
  actions: [{ id: "enrich", label: "Enrich", kind: "chat", role: "general", template: "templates/enrich.md" }],
  collectionActions: [{ id: "audit", label: "Audit", kind: "chat", role: "general", template: "templates/audit.md" }],
};

let server: Server;
let base: string;

beforeAll(async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "mt-col-"));
  mkdirSync(path.join(ws, ".claude", "skills", "testcol"), { recursive: true });
  writeFileSync(path.join(ws, ".claude", "skills", "testcol", "schema.json"), JSON.stringify(SCHEMA));
  // Action templates live under the skill dir's templates/ (readSkillTemplate).
  mkdirSync(path.join(ws, ".claude", "skills", "testcol", "templates"), { recursive: true });
  writeFileSync(path.join(ws, ".claude", "skills", "testcol", "templates", "enrich.md"), "ENRICH_TEMPLATE: complete this record.");
  writeFileSync(path.join(ws, ".claude", "skills", "testcol", "templates", "audit.md"), "AUDIT_TEMPLATE: review all records.");
  mkdirSync(path.join(ws, "data", "testcol", "items"), { recursive: true });
  writeFileSync(path.join(ws, "data", "testcol", "items", "item1.json"), JSON.stringify({ id: "item1", name: "Foo" }));
  mkdirSync(path.join(ws, "data", "skills", "testcol", "views"), { recursive: true });
  writeFileSync(path.join(ws, "data", "skills", "testcol", "views", "v1.html"), "<head></head><body>view</body>");
  writeFileSync(path.join(ws, "data", "skills", "testcol", "views", "v2.html"), "<head></head><body>editable</body>");

  // A singleton collection with a write-capable view, to prove PUT /view-data
  // enforces the singleton invariant (only the fixed id is writable).
  const SINGLETON_SCHEMA = {
    title: "Singleton",
    icon: "person",
    dataPath: "data/singletoncol/items",
    primaryKey: "id",
    singleton: "me",
    fields: { id: { type: "string", label: "ID", primary: true, required: true }, name: { type: "string", label: "Name" } },
    views: [{ id: "sv", file: "views/sv.html", label: "Editable", capabilities: ["read", "write"] }],
  };
  mkdirSync(path.join(ws, ".claude", "skills", "singletoncol"), { recursive: true });
  writeFileSync(path.join(ws, ".claude", "skills", "singletoncol", "schema.json"), JSON.stringify(SINGLETON_SCHEMA));
  mkdirSync(path.join(ws, "data", "singletoncol", "items"), { recursive: true });
  writeFileSync(path.join(ws, "data", "singletoncol", "items", "me.json"), JSON.stringify({ id: "me", name: "Owner" }));
  mkdirSync(path.join(ws, "data", "skills", "singletoncol", "views"), { recursive: true });
  writeFileSync(path.join(ws, "data", "skills", "singletoncol", "views", "sv.html"), "<head></head><body>editable</body>");

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

  it("grants a write token to a view that declares write", async () => {
    const res = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capabilities: string[] };
    expect(body.capabilities).toEqual(["read", "write"]);
  });

  it("advertises PUT in the view-data CORS preflight", async () => {
    const res = await fetch(`${base}/api/collections/testcol/view-data`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  it("401s a PUT made with a read-only token", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v1" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "item1", name: "Hacked" }], mode: "merge" }),
    });
    expect(res.status).toBe(401);
  });

  it("merge-writes a partial record without clobbering untouched fields", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    const { token } = (await mint.json()) as { token: string };
    // item1 starts as { id: "item1", name: "Foo" }. Merge a new field only.
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "item1", note: "graded" }], mode: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; name?: string; note?: string }>; rejected: unknown[] };
    expect(body.rejected).toEqual([]);
    // name survived the partial write; note was added.
    expect(body.items[0]).toMatchObject({ id: "item1", name: "Foo", note: "graded" });
  });

  it("rejects an item missing its primary key", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ name: "no id" }], mode: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; rejected: Array<{ problem: string }> };
    expect(body.items).toEqual([]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].problem).toContain("primary key");
  });

  it("rejects (does not upsert) a merge write to a missing id", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "ghost", note: "should not exist" }], mode: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; rejected: Array<{ id: string; problem: string }> };
    expect(body.items).toEqual([]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].problem).toContain("not found");
    // and no record file was created for the ghost id
    const detail = await fetch(`${base}/api/collections/testcol/detail`);
    const ids = ((await detail.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(ids).not.toContain("ghost");
  });

  it("rejects a non-singleton id on a singleton collection", async () => {
    const mint = await fetch(`${base}/api/collections/singletoncol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "sv" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/singletoncol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "intruder", name: "Evil" }], mode: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; rejected: Array<{ id: string; problem: string }> };
    expect(body.items).toEqual([]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].problem).toContain("singleton");
  });

  it("allows the fixed id on a singleton collection", async () => {
    const mint = await fetch(`${base}/api/collections/singletoncol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "sv" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/singletoncol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "me", note: "ok" }], mode: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; name?: string; note?: string }>; rejected: unknown[] };
    expect(body.rejected).toEqual([]);
    expect(body.items[0]).toMatchObject({ id: "me", name: "Owner", note: "ok" });
  });
});

describe("record CRUD", () => {
  // Functions, not constants: `base` is only assigned in beforeAll (after the
  // describe body runs), so the URLs must be built at call time.
  const items = () => `${base}/api/collections/testcol/items`;
  const itemUrl = (id: string) => `${base}/api/collections/testcol/items/${id}`;
  const detailItems = async () =>
    ((await (await fetch(`${base}/api/collections/testcol/detail`)).json()) as { items: Array<{ id: string; name?: string }> }).items;

  it("creates, updates, then deletes a record", async () => {
    const create = await fetch(items(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "crud1", name: "New" }),
    });
    expect(create.status).toBe(200);
    expect((await create.json()) as { itemId: string }).toMatchObject({ itemId: "crud1" });
    expect((await detailItems()).find((i) => i.id === "crud1")).toMatchObject({ name: "New" });

    const upd = await fetch(itemUrl("crud1"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "crud1", name: "Updated" }),
    });
    expect(upd.status).toBe(200);
    expect(((await upd.json()) as { item: { name: string } }).item).toMatchObject({ name: "Updated" });

    const del = await fetch(itemUrl("crud1"), { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true, itemId: "crud1" });
    expect((await detailItems()).find((i) => i.id === "crud1")).toBeUndefined();
  });

  it("409s creating a record whose id already exists", async () => {
    const dupe = await fetch(items(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "item1", name: "dupe" }) });
    expect(dupe.status).toBe(409);
  });

  it("400s on a non-object create body", async () => {
    const res = await fetch(items(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([1, 2, 3]) });
    expect(res.status).toBe(400);
  });

  it("404s update/delete on a missing collection", async () => {
    const put = await fetch(`${base}/api/collections/nope/items/x`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x" }),
    });
    expect(put.status).toBe(404);
    expect((await fetch(`${base}/api/collections/nope/items/x`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("action routes (seed prompts)", () => {
  const post = (url: string) => fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

  it("returns a per-record action's seed prompt + role", async () => {
    const res = await post("/api/collections/testcol/items/item1/actions/enrich");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prompt: string; role: string };
    expect(body.role).toBe("general");
    expect(body.prompt).toContain("ENRICH_TEMPLATE");
  });

  it("returns a collection-level action's seed prompt + role", async () => {
    const res = await post("/api/collections/testcol/actions/audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prompt: string; role: string };
    expect(body.role).toBe("general");
    expect(body.prompt).toContain("AUDIT_TEMPLATE");
  });

  it("404s an unknown action id", async () => {
    expect((await post("/api/collections/testcol/items/item1/actions/nope")).status).toBe(404);
    expect((await post("/api/collections/testcol/actions/nope")).status).toBe(404);
  });

  it("404s a per-record action on a missing item", async () => {
    expect((await post("/api/collections/testcol/items/ghost/actions/enrich")).status).toBe(404);
  });
});

describe("collection registry routes (Discover tab)", () => {
  beforeEach(() => {
    vi.mocked(listRegistry).mockReset();
    vi.mocked(importRegistry).mockReset();
  });

  it("GET /registry/list returns the engine's merged catalog", async () => {
    const payload = {
      registries: [{ name: "official", status: "ok" as const, generatedAt: null, error: null, entryCount: 1 }],
      stale: false,
      collections: [{ id: "a/b", author: "a", slug: "b", title: "B", registryName: "official" }],
    };
    vi.mocked(listRegistry).mockResolvedValue(payload as never);
    const res = await fetch(`${base}/api/collections/registry/list`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it("POST /registry/import installs and returns the engine response", async () => {
    vi.mocked(importRegistry).mockResolvedValue({
      ok: true,
      response: { localSlug: "b", updated: false, seedWritten: 3, seedSkipped: false },
    } as never);
    const res = await fetch(`${base}/api/collections/registry/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "a", slug: "b", registry: "official" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ localSlug: "b", updated: false, seedWritten: 3, seedSkipped: false });
    expect(vi.mocked(importRegistry)).toHaveBeenCalledWith("a", "b", expect.any(String), "official");
  });

  it("POST /registry/import passes the engine's failure status straight through", async () => {
    vi.mocked(importRegistry).mockResolvedValue({ ok: false, status: 404, error: "not found" } as never);
    const res = await fetch(`${base}/api/collections/registry/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "a", slug: "missing" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("POST /registry/import 400s without author/slug and never calls the engine", async () => {
    const res = await fetch(`${base}/api/collections/registry/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "b" }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(importRegistry)).not.toHaveBeenCalled();
  });
});

describe("collection / view delete routes", () => {
  beforeEach(() => {
    vi.mocked(deleteCollection).mockReset();
    vi.mocked(deleteCustomView).mockReset();
  });

  it("DELETE /:slug archives + removes a deletable collection", async () => {
    vi.mocked(deleteCollection).mockResolvedValue({ kind: "ok", slug: "testcol", archivePath: "archive/2026-x" } as never);
    const res = await fetch(`${base}/api/collections/testcol`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, slug: "testcol" });
  });

  it("DELETE /:slug returns 403 with the refusal reason for a non-ok result", async () => {
    vi.mocked(deleteCollection).mockResolvedValue({ kind: "preset", slug: "testcol" } as never);
    const res = await fetch(`${base}/api/collections/testcol`, { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });

  it("DELETE /:slug 404s an unknown collection without calling the engine", async () => {
    const res = await fetch(`${base}/api/collections/nope`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(vi.mocked(deleteCollection)).not.toHaveBeenCalled();
  });

  it("DELETE /:slug/views/:viewId removes a view, refuses non-ok, 404s not-found", async () => {
    vi.mocked(deleteCustomView).mockResolvedValueOnce({ kind: "ok", viewId: "v1" } as never);
    expect((await fetch(`${base}/api/collections/testcol/views/v1`, { method: "DELETE" })).status).toBe(200);
    vi.mocked(deleteCustomView).mockResolvedValueOnce({ kind: "preset" } as never);
    expect((await fetch(`${base}/api/collections/testcol/views/v1`, { method: "DELETE" })).status).toBe(403);
    vi.mocked(deleteCustomView).mockResolvedValueOnce({ kind: "not-found", viewId: "v1" } as never);
    expect((await fetch(`${base}/api/collections/testcol/views/v1`, { method: "DELETE" })).status).toBe(404);
  });
});
