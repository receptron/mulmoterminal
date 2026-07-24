// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRemoteHostHandlers } from "./handlers.js";
import { initCollectionsBackend } from "../collections.js";

const unusedTerminalDeps = {
  listTerminalSessions: async () => [],
  captureTerminalScreen: async () => ({ screen: "", suggestion: "" }),
  writeToSession: () => false,
  canClearBox: () => false,
};

describe("createRemoteHostHandlers", () => {
  let ws: string;
  let spawned: string[];
  let ingested: string[][];
  let cleanedUp: string[][];
  let handlers: ReturnType<typeof createRemoteHostHandlers>;

  beforeEach(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-rh-"));
    spawned = [];
    ingested = [];
    cleanedUp = [];
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: (message) => {
        spawned.push(message);
        return { chatId: `chat-${spawned.length}` };
      },
      // Fake ingest: record the storage ids, echo a saved path per file, and a no-op
      // staging cleanup (tracked so a test can assert it runs after a successful spawn).
      ingest: async (storageIds) => {
        ingested.push(storageIds);
        return {
          attachments: storageIds.map((id) => ({ path: `data/attachments/${id}.jpg`, mimeType: "image/jpeg" })),
          cleanupStaging: async () => {
            cleanedUp.push(storageIds);
          },
        };
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

  // Regression (#746): staging is reaped only AFTER a successful spawn.
  it("startChat cleans up staging after spawning succeeds", async () => {
    await handlers.startChat({ message: "hi", attachments: [{ storage_id: "abc" }] });
    expect(spawned).toHaveLength(1);
    expect(cleanedUp).toEqual([["abc"]]); // cleanup ran, once, after spawn
  });

  // Regression (#746 Codex review): the chat already started, so a cleanupStaging rejection
  // must NOT turn the successful start into a reported failure (which the phone would retry,
  // spawning a duplicate chat). The rejection is isolated at the handler boundary.
  it("startChat still succeeds when staging cleanup rejects (chat already spawned)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: (message) => {
        spawned.push(message);
        return { chatId: "chat-ok" };
      },
      ingest: async () => ({
        attachments: [],
        cleanupStaging: async () => {
          throw new Error("storage offline");
        },
      }),
      ...unusedTerminalDeps,
    });
    const result = await handlers.startChat({ message: "hi", attachments: [{ storage_id: "abc" }] });
    expect(result).toEqual({ started: true, chatId: "chat-ok" });
    expect(spawned).toHaveLength(1); // spawned exactly once — no false failure, no retry
    warn.mockRestore();
  });

  // Regression (#746): if the spawn throws, staging is NOT deleted, so the phone can retry
  // with the same storage_ids and still find its uploads.
  it("startChat does NOT clean up staging when the spawn fails", async () => {
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: () => {
        throw new Error("no provider token");
      },
      ingest: async (storageIds) => ({
        attachments: storageIds.map((id) => ({ path: `data/attachments/${id}.jpg`, mimeType: "image/jpeg" })),
        cleanupStaging: async () => {
          cleanedUp.push(storageIds);
        },
      }),
      ...unusedTerminalDeps,
    });
    await expect(handlers.startChat({ message: "hi", attachments: [{ storage_id: "abc" }] })).rejects.toThrow(/no provider token/);
    expect(cleanedUp).toEqual([]); // staging survives for a retry
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
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      ...unusedTerminalDeps,
    });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("lists plain skill ids and subtracts collection slugs", async () => {
    const { skills } = (await handlers.listSkills({})) as unknown as { skills: string[] };
    expect(skills).toContain("mt-plain-skill");
    expect(skills).not.toContain("mt-collection");
  });
});
