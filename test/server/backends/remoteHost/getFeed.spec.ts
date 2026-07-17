// @vitest-environment node
//
// getFeed reuses the collection page path (listItems + toDetail + pageResult)
// over a feed located in the feed registry. This exercises it end-to-end with a
// real on-disk dataDir, mocking only listFeeds so the test needn't stand up the
// full feed-discovery/host stack. Kept in its own file so the module-level
// listFeeds mock can't reach handlers.spec's real-collection-host listSkills test.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listFeeds } from "@mulmoclaude/core/feeds/server";
import { createRemoteHostHandlers } from "../../../../server/backends/remoteHost/handlers.js";
import { initCollectionsBackend } from "../../../../server/backends/remoteHost/collections.js";

// Only listFeeds is stubbed; listItems/toDetail/deriveItems/pageResult stay real.
vi.mock("@mulmoclaude/core/feeds/server", () => ({ listFeeds: vi.fn(), readFeedState: vi.fn() }));

// A feed is a LoadedCollection with an `ingest` block. dataDir points at a real
// temp dir so the real listItems reads the records off disk.
const feedFixture = (dataDir: string) => ({
  slug: "news",
  source: "feed" as const,
  schema: {
    title: "News",
    icon: "rss",
    dataPath: "data/feeds/news",
    primaryKey: "id",
    ingest: { kind: "rss", schedule: "hourly" },
    fields: {
      id: { type: "string", label: "ID", primary: true, required: true },
      title: { type: "string", label: "Title" },
    },
  },
  dataDir,
  skillDir: path.join(dataDir, "..", "skill"),
});

describe("createRemoteHostHandlers · getFeed", () => {
  let ws: string;
  let dataDir: string;
  let handlers: ReturnType<typeof createRemoteHostHandlers>;

  // The collection host is a process-global that refuses re-config with a
  // different workspace, so configure it once for the whole block.
  beforeAll(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-rh-feed-"));
    // listItems resolves against the configured collection host's workspace root.
    initCollectionsBackend({ workspace: ws });
    // Records live at the real feed layout, <ws>/data/feeds/<slug>.
    dataDir = path.join(ws, "data", "feeds", "news");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, "item1.json"), JSON.stringify({ id: "1", title: "First" }));
    writeFileSync(path.join(dataDir, "item2.json"), JSON.stringify({ id: "2", title: "Second" }));
    handlers = createRemoteHostHandlers({ workspace: ws, spawnChat: () => ({ chatId: "x" }), ingest: async () => [] });
  });
  afterEach(() => vi.mocked(listFeeds).mockReset());
  afterAll(() => rmSync(ws, { recursive: true, force: true }));

  it("returns the feed detail + a page of its records", async () => {
    vi.mocked(listFeeds).mockResolvedValue([feedFixture(dataDir)] as never);
    const result = (await handlers.getFeed({ slug: "news" })) as unknown as {
      collection: { title: string };
      items: Array<{ id: string }>;
      total: number;
      offset: number;
      limit: number;
    };
    expect(vi.mocked(listFeeds)).toHaveBeenCalledWith(ws);
    expect(result.collection.title).toBe("News");
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id).sort()).toEqual(["1", "2"]);
  });

  it("honors offset/limit paging", async () => {
    vi.mocked(listFeeds).mockResolvedValue([feedFixture(dataDir)] as never);
    const result = (await handlers.getFeed({ slug: "news", offset: 1, limit: 1 })) as unknown as {
      items: unknown[];
      total: number;
      offset: number;
      limit: number;
    };
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.offset).toBe(1);
    expect(result.limit).toBe(1);
  });

  it("throws when the feed slug is not registered", async () => {
    vi.mocked(listFeeds).mockResolvedValue([feedFixture(dataDir)] as never);
    await expect(handlers.getFeed({ slug: "missing" })).rejects.toThrow(/feed 'missing' not found/);
  });
});
