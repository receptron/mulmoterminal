// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRemoteHostHandlers } from "./handlers.js";

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
    });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("exposes every expected handler", () => {
    for (const name of [
      "listCollections",
      "getCollection",
      "listFeeds",
      "listShortcuts",
      "listAccountingBooks",
      "startChat",
      "getRemoteView",
      "getRemoteViewItems",
      "mutateRemoteViewItem",
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
