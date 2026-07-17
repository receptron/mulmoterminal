// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import sharp from "sharp";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { initCollectionsBackend, mountCollectionRoutes } from "../../../server/backends/collections.js";
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
// loadCollection is wrapped (default = real implementation) so a single test can
// inject a crafted collection: a collection-level `kind: "mutate"` action can't
// exist on disk (the schema refine rejects it), yet the route's defensive 400
// must still be covered.
import { deleteCollection, deleteCustomView, loadCollection } from "@mulmoclaude/core/collection/server";
vi.mock("@mulmoclaude/core/collection/server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mulmoclaude/core/collection/server")>();
  return { ...orig, deleteCollection: vi.fn(), deleteCustomView: vi.fn(), loadCollection: vi.fn(orig.loadCollection) };
});

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
    status: { type: "enum", label: "Status", values: ["open", "closed"] },
  },
  views: [
    { id: "v1", file: "views/v1.html", label: "Custom", capabilities: ["read"] },
    { id: "v2", file: "views/v2.html", label: "Editable", capabilities: ["read", "write"] },
    { id: "phone", file: "views/phone.html", label: "Phone", target: "mobile", editableFields: ["name"] },
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
  writeFileSync(path.join(ws, "data", "skills", "testcol", "views", "phone.html"), "<head></head><body>phone-view</body>");

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

  // A collection with a mobile view that declares an image field, so the
  // remote-view items route can inline a real thumbnail (isolated from testcol so
  // its record counts don't perturb the detail/view-data tests above).
  const PHOTOS_SCHEMA = {
    title: "Photos",
    icon: "image",
    dataPath: "data/photoscol/items",
    primaryKey: "id",
    fields: {
      id: { type: "string", label: "ID", primary: true, required: true },
      name: { type: "string", label: "Name" },
      photo: { type: "image", label: "Photo" },
    },
    views: [{ id: "gallery", file: "views/gallery.html", label: "Gallery", target: "mobile", imageFields: ["photo"] }],
  };
  mkdirSync(path.join(ws, ".claude", "skills", "photoscol"), { recursive: true });
  writeFileSync(path.join(ws, ".claude", "skills", "photoscol", "schema.json"), JSON.stringify(PHOTOS_SCHEMA));
  mkdirSync(path.join(ws, "data", "skills", "photoscol", "views"), { recursive: true });
  writeFileSync(path.join(ws, "data", "skills", "photoscol", "views", "gallery.html"), "<head></head><body>gallery</body>");
  mkdirSync(path.join(ws, "data", "photoscol", "images"), { recursive: true });
  const pic = await sharp({ create: { width: 40, height: 24, channels: 3, background: { r: 200, g: 30, b: 90 } } })
    .png()
    .toBuffer();
  writeFileSync(path.join(ws, "data", "photoscol", "images", "pic.png"), pic);
  mkdirSync(path.join(ws, "data", "photoscol", "items"), { recursive: true });
  writeFileSync(path.join(ws, "data", "photoscol", "items", "p1.json"), JSON.stringify({ id: "p1", name: "First", photo: "data/photoscol/images/pic.png" }));

  // Point the collection host at the fixture. vitest isolates modules
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
    const body = (await res.json()) as { written: string[]; rejected: unknown[] };
    expect(body.rejected).toEqual([]);
    expect(body.written).toEqual(["item1"]);
    // name survived the partial write; note was added.
    const detail = await fetch(`${base}/api/collections/testcol/detail`);
    const item1 = ((await detail.json()) as { items: Array<{ id: string; name?: string; note?: string }> }).items.find((i) => i.id === "item1");
    expect(item1).toMatchObject({ id: "item1", name: "Foo", note: "graded" });
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
    const body = (await res.json()) as { written: string[]; rejected: Array<{ problem: string }> };
    expect(body.written).toEqual([]);
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
    const body = (await res.json()) as { written: string[]; rejected: Array<{ id: string; problem: string }> };
    expect(body.written).toEqual([]);
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
    const body = (await res.json()) as { written: string[]; rejected: Array<{ id: string; problem: string }> };
    expect(body.written).toEqual([]);
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
    const body = (await res.json()) as { written: string[]; rejected: unknown[] };
    expect(body.rejected).toEqual([]);
    expect(body.written).toEqual(["me"]);
  });

  it('mode "create" rejects an id that already exists', async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "item1", name: "Dupe" }], mode: "create" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { written: string[]; rejected: Array<{ problem: string }> };
    expect(body.written).toEqual([]);
    expect(body.rejected[0].problem).toContain("already exists");
  });

  it("defaults to upsert (full replace) when mode is omitted", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    const { token } = (await mint.json()) as { token: string };
    // A complete record with no mode → written; it replaces whatever was there.
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "upserted", name: "Fresh" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { written: string[]; rejected: unknown[] };
    expect(body.written).toEqual(["upserted"]);
    expect(body.rejected).toEqual([]);
  });

  it("400s an unknown mode", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "item1" }], mode: "replace" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a row that fails schema validation (bad enum value)", async () => {
    const mint = await fetch(`${base}/api/collections/testcol/view-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "v2" }),
    });
    const { token } = (await mint.json()) as { token: string };
    const res = await fetch(`${base}/api/collections/testcol/view-data`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "item1", status: "bogus" }], mode: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { written: string[]; rejected: Array<{ problem: string }> };
    expect(body.written).toEqual([]);
    expect(body.rejected[0].problem).toContain("not one of");
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

  // #210 regression: the seed prompt must embed the <collection_paths> block so the skill
  // can resolve skillDir/dataPath. Both routes silently dropped it before the fix.
  const expectCollectionPaths = (prompt: string) => {
    // The prompt's preamble literally names the tag ("<collection_paths> block carries…")
    // before the real block, so anchor on the JSON object to skip that prose.
    const block = prompt.match(/<collection_paths>\s*(\{[\s\S]*?\})\s*<\/collection_paths>/);
    expect(block).not.toBeNull();
    const paths = JSON.parse(block?.[1] ?? "{}");
    expect(paths.slug).toBe("testcol");
    expect(typeof paths.skillDir).toBe("string");
    expect(typeof paths.dataPath).toBe("string");
  };

  it("returns a per-record action's seed prompt + role (with collection paths)", async () => {
    const res = await post("/api/collections/testcol/items/item1/actions/enrich");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prompt: string; role: string };
    expect(body.role).toBe("general");
    expect(body.prompt).toContain("ENRICH_TEMPLATE");
    expectCollectionPaths(body.prompt);
  });

  it("returns a collection-level action's seed prompt + role (with collection paths)", async () => {
    const res = await post("/api/collections/testcol/actions/audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prompt: string; role: string };
    expect(body.role).toBe("general");
    expect(body.prompt).toContain("AUDIT_TEMPLATE");
    expectCollectionPaths(body.prompt);
  });

  it("404s an unknown action id", async () => {
    expect((await post("/api/collections/testcol/items/item1/actions/nope")).status).toBe(404);
    expect((await post("/api/collections/testcol/actions/nope")).status).toBe(404);
  });

  it("404s a per-record action on a missing item", async () => {
    expect((await post("/api/collections/testcol/items/ghost/actions/enrich")).status).toBe(404);
  });
});

// Mutate actions (kind: "mutate") — schema refine doesn't support mutate on disk,
// so we inject crafted collections per-test. This covers the route's status mapping
// for item-level mutate handlers (itemActionHandler, respondForMutateAction).

describe('record-level mutate actions (kind: "mutate")', () => {
  const post = (url: string, body: unknown = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("404s on missing record", async () => {
    vi.mocked(loadCollection).mockResolvedValueOnce({
      slug: "mutatecol",
      schema: {
        fields: { id: { type: "string", label: "ID", primary: true, required: true }, status: { type: "enum", label: "Status", values: ["open", "closed"] } },
        actions: [{ id: "close", label: "Close", kind: "mutate" as unknown as "chat" | "agent" | "mutate", set: { status: "closed" } }],
      },
      dataDir: "/data/mutatecol/items",
      skillDir: "/data/skills/mutatecol",
    } as never);
    const res = await post("/api/collections/mutatecol/items/ghost/actions/close");
    expect(res.status).toBe(404);
  });
});

describe("collection-level mutate action defense", () => {
  const post = (url: string, body: unknown = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("400s a collection-level mutate action (record-level only)", async () => {
    // Can't exist on disk — the schema refine rejects mutate in
    // `collectionActions` — so inject a crafted collection to cover the
    // route's defensive twin of that refine.
    vi.mocked(loadCollection).mockResolvedValueOnce({
      slug: "crafted",
      schema: { collectionActions: [{ id: "bulkclose", label: "Bulk close", kind: "mutate", set: { status: "closed" } }] },
    } as never);
    const res = await post("/api/collections/crafted/actions/bulkclose");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("record-level");
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

// The desktop phone-frame preview's data source: a target:"mobile" view built
// host-side into its sandboxed srcdoc, plus its writable-view mutate channel.
describe("mobile custom views (phone-frame preview)", () => {
  it("GET /:slug/remote-view builds a mobile view into a sandboxed srcdoc", async () => {
    const res = await fetch(`${base}/api/collections/testcol/remote-view?id=phone&locale=en`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.view).toMatchObject({ id: "phone", target: "mobile" });
    expect(body.srcdoc).toContain("phone-view"); // the authored HTML body
    expect(body.srcdoc).toContain("connect-src 'none'"); // the stricter mobile CSP
    expect(typeof body.bytes).toBe("number");
  });

  it("GET /:slug/remote-view refuses a desktop view (400) and 404s an unknown view/collection", async () => {
    expect((await fetch(`${base}/api/collections/testcol/remote-view?id=v1`)).status).toBe(400); // not target:mobile
    expect((await fetch(`${base}/api/collections/testcol/remote-view?id=nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/collections/nope/remote-view?id=phone`)).status).toBe(404);
  });

  it("POST /:slug/remote-view/:viewId/mutate updates an editable field, forbids a non-editable one", async () => {
    const ok = await fetch(`${base}/api/collections/testcol/remote-view/phone/mutate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "update", id: "item1", patch: { name: "Renamed" } }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).item.name).toBe("Renamed");

    // `status` is not in the view's editableFields → host-side policy refuses it.
    const forbidden = await fetch(`${base}/api/collections/testcol/remote-view/phone/mutate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "update", id: "item1", patch: { status: "closed" } }),
    });
    expect(forbidden.status).toBe(403);
  });

  it("POST /:slug/remote-view/:viewId/mutate 400s a malformed request", async () => {
    const res = await fetch(`${base}/api/collections/testcol/remote-view/phone/mutate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonsense: true }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /:slug/remote-view/:viewId/items inlines the view's image field as a data URL thumbnail", async () => {
    const res = await fetch(`${base}/api/collections/photoscol/remote-view/gallery/items`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inlined).toBeGreaterThanOrEqual(1);
    const record = body.page.items.find((item: { id: string }) => item.id === "p1");
    expect(record.photo).toMatch(/^data:image\/jpeg;base64,/); // the path was replaced by a thumbnail
  });

  it("GET /:slug/remote-view/:viewId/items 404s an unknown view", async () => {
    expect((await fetch(`${base}/api/collections/photoscol/remote-view/nope/items`)).status).toBe(404);
  });
});
