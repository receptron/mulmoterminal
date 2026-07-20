// @vitest-environment node
// Host binding for the shared manageCollection tool: the engine itself is
// tested upstream (@mulmoclaude/core + MulmoClaude's suite), so these tests
// pin MulmoTerminal's glue — the gui-chat-protocol definition adaptation,
// the workspace binding through the configured collection host, and the
// bundledHelpsDir injection that keeps schemaDocs working on a workspace
// that was never seeded with config/helps.
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MANAGE_COLLECTION, manageCollectionHandler } from "../../../server/infra/collection-tool";
import { HOST_TOOL_DEFINITIONS } from "../../../server/infra/host-tools";
import { initCollectionsBackend } from "../../../server/backends/collections";

const SCHEMA = {
  title: "Tool Fixture",
  icon: "star",
  dataPath: "data/toolcol/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    name: { type: "string", label: "Name" },
  },
};

beforeAll(() => {
  const ws = mkdtempSync(path.join(tmpdir(), "mt-coltool-"));
  mkdirSync(path.join(ws, ".claude", "skills", "toolcol"), { recursive: true });
  writeFileSync(path.join(ws, ".claude", "skills", "toolcol", "schema.json"), JSON.stringify(SCHEMA));
  mkdirSync(path.join(ws, "data", "toolcol", "items"), { recursive: true });
  writeFileSync(path.join(ws, "data", "toolcol", "items", "t1.json"), JSON.stringify({ id: "t1", name: "First" }));
  // The tool binds NO workspaceRoot — it must ride the same configured
  // collection host every REST route uses.
  initCollectionsBackend({ workspace: ws });
});

describe("MANAGE_COLLECTION definition", () => {
  it("is registered as a host tool with the adapted gui-chat-protocol shape", () => {
    expect(HOST_TOOL_DEFINITIONS.some((def) => def.name === "manageCollection")).toBe(true);
    expect(MANAGE_COLLECTION.type).toBe("function");
    expect(MANAGE_COLLECTION.prompt).toContain("manageCollection");
    // inputSchema → parameters: the action enum must survive the adaptation.
    const actionEnum = MANAGE_COLLECTION.parameters?.properties.action.enum;
    expect(actionEnum).toContain("getItems");
    expect(actionEnum).toContain("putSchema");
  });
});

describe("manageCollectionHandler", () => {
  it("reads records through the configured collection host", async () => {
    const result = JSON.parse(await manageCollectionHandler({ action: "getItems", slug: "toolcol" })) as {
      collection: string;
      count: number;
      items: Array<Record<string, unknown>>;
    };
    expect(result.collection).toBe("toolcol");
    expect(result.count).toBe(1);
    expect(result.items[0].name).toBe("First");
  });

  it("writes a validated record", async () => {
    const put = JSON.parse(await manageCollectionHandler({ action: "putItems", slug: "toolcol", items: [{ id: "t2", name: "Second" }] })) as {
      written: string[];
      rejected: unknown[];
    };
    expect(put.written).toEqual(["t2"]);
    expect(put.rejected).toEqual([]);
  });

  it("rejects an invalid row with a per-row problem instead of throwing", async () => {
    const put = JSON.parse(await manageCollectionHandler({ action: "putItems", slug: "toolcol", items: [{ name: "no id" }] })) as {
      written: string[];
      rejected: Array<{ problem: string }>;
    };
    expect(put.written).toEqual([]);
    expect(put.rejected[0].problem).toContain("no 'id' value");
  });

  it("serves the bundled authoring reference for schemaDocs (unseeded workspace)", async () => {
    const docs = await manageCollectionHandler({ action: "schemaDocs" });
    expect(docs).not.toContain("could not read");
    expect(docs).toContain("Collection skills");
  });

  it("narrates an unknown collection instead of throwing", async () => {
    const result = await manageCollectionHandler({ action: "getItems", slug: "nope" });
    expect(result).toContain("unknown collection");
  });
});
