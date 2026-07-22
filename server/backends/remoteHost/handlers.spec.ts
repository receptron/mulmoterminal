// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRemoteHostHandlers } from "./handlers.js";
import { initCollectionsBackend } from "../collections.js";

const unusedTerminalDeps = {
  listTerminalSessions: async () => [],
  captureTerminalScreen: async () => ({ screen: "", suggestion: "" }),
  writeToSession: () => false,
};

describe("createRemoteHostHandlers", () => {
  let ws: string;
  let spawned: string[];
  let ingested: string[][];
  let handlers: ReturnType<typeof createRemoteHostHandlers>;

  beforeEach(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-rh-"));
    spawned = [];
    ingested = [];
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: (message) => {
        spawned.push(message);
        return { chatId: `chat-${spawned.length}` };
      },
      // Fake ingest: record the storage ids, echo a saved path per file.
      ingest: async (storageIds) => {
        ingested.push(storageIds);
        return storageIds.map((id) => ({ path: `data/attachments/${id}.jpg`, mimeType: "image/jpeg" }));
      },
      ...unusedTerminalDeps,
    });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("exposes every expected handler", () => {
    for (const name of [
      "listCollections",
      "getCollection",
      "listFeeds",
      "getFeed",
      "listShortcuts",
      "listSkills",
      "listAccountingBooks",
      "startChat",
      "getRemoteView",
      "getRemoteViewItems",
      "mutateRemoteViewItem",
      "google.calendar.createEvent",
      "google.calendar.listEvents",
      "google.calendar.listCalendars",
      "google.calendar.colors",
    ]) {
      expect(typeof handlers[name]).toBe("function");
    }
  });

  it("startChat seeds a visible chat with the trimmed message and returns the chatId", async () => {
    const result = await handlers.startChat({ message: "  hello world  " });
    expect(spawned).toEqual(["hello world"]);
    expect(result).toEqual({ started: true, chatId: "chat-1" });
  });

  it("startChat rejects an empty message without spawning", async () => {
    await expect(handlers.startChat({ message: "   " })).rejects.toThrow(/message is required/);
    expect(spawned).toEqual([]);
  });

  it("startChat ingests attachments and references their saved paths in the prompt", async () => {
    const result = await handlers.startChat({ message: "look at this", attachments: [{ storage_id: "abc" }, { storage_id: "def" }] });
    expect(ingested).toEqual([["abc", "def"]]);
    expect(spawned[0]).toContain("look at this");
    expect(spawned[0]).toContain("data/attachments/abc.jpg");
    expect(spawned[0]).toContain("data/attachments/def.jpg");
    expect(result).toEqual({ started: true, chatId: "chat-1" });
  });

  it("startChat rejects a malformed attachments param without spawning", async () => {
    await expect(handlers.startChat({ message: "hi", attachments: [{ nope: 1 }] })).rejects.toThrow(/storage_id/);
    expect(spawned).toEqual([]);
  });

  it("listShortcuts returns the pinned shortcuts read from the workspace", async () => {
    mkdirSync(path.join(ws, "config"), { recursive: true });
    writeFileSync(
      path.join(ws, "config", "shortcuts.json"),
      JSON.stringify({ shortcuts: [{ kind: "collection", slug: "tasks", title: "Tasks", icon: "check" }] }),
    );
    const result = (await handlers.listShortcuts({})) as unknown as { shortcuts: unknown[] };
    expect(result.shortcuts).toEqual([{ kind: "collection", slug: "tasks", title: "Tasks", icon: "check" }]);
  });

  it("listShortcuts returns an empty list when no shortcuts file exists", async () => {
    const result = (await handlers.listShortcuts({})) as unknown as { shortcuts: unknown[] };
    expect(result.shortcuts).toEqual([]);
  });
});

// listSkills leans on the globally-configured collection host (discoverCollections)
// to subtract collection slugs, so it gets its own block that wires that host at a
// tmp workspace. Assertions use contains/not-contains because the user scope scans
// the developer's real ~/.claude/skills, which the test can't control.
describe("createRemoteHostHandlers · listSkills", () => {
  let ws: string;
  let handlers: ReturnType<typeof createRemoteHostHandlers>;

  const COL_SCHEMA = {
    title: "My Collection",
    icon: "star",
    dataPath: "data/mycol/items",
    primaryKey: "id",
    fields: { id: { type: "string", label: "ID", primary: true, required: true } },
  };

  beforeEach(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-rh-skills-"));
    // A plain skill (SKILL.md only) — should be listed.
    mkdirSync(path.join(ws, ".claude", "skills", "mt-plain-skill"), { recursive: true });
    writeFileSync(path.join(ws, ".claude", "skills", "mt-plain-skill", "SKILL.md"), "---\ndescription: a plain skill\n---\n\nbody");
    // A collection that ALSO ships a SKILL.md — appears in the raw skill scan but
    // must be subtracted (listCollections serves it), so it should NOT be listed.
    mkdirSync(path.join(ws, ".claude", "skills", "mt-collection"), { recursive: true });
    writeFileSync(path.join(ws, ".claude", "skills", "mt-collection", "schema.json"), JSON.stringify(COL_SCHEMA));
    writeFileSync(path.join(ws, ".claude", "skills", "mt-collection", "SKILL.md"), "---\ndescription: a collection\n---\n\nbody");
    mkdirSync(path.join(ws, "data", "mycol", "items"), { recursive: true });

    initCollectionsBackend({ workspace: ws });
    handlers = createRemoteHostHandlers({ workspace: ws, spawnChat: () => ({ chatId: "x" }), ingest: async () => [], ...unusedTerminalDeps });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("lists plain skill ids and subtracts collection slugs", async () => {
    const { skills } = (await handlers.listSkills({})) as unknown as { skills: string[] };
    expect(skills).toContain("mt-plain-skill");
    expect(skills).not.toContain("mt-collection");
  });
});
