// @vitest-environment node
//
// getFeed reuses the collection page path (storeFor + toDetail + pageResult)
// over a feed located in the feed registry. This exercises it end-to-end with a
// real on-disk dataDir, mocking only listFeeds so the test needn't stand up the
// full feed-discovery/host stack. Kept in its own file so the module-level
// listFeeds mock can't reach handlers.spec's real-collection-host listSkills test.
//
// The last block stubs the store seam instead, covering the non-file case the
// on-disk fixture cannot reach (#1488).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listFeeds } from "@mulmoclaude/core/feeds/server";
import { createRemoteHostHandlers } from "./handlers/index.js";
import { createGetFeed, type GetFeedDeps } from "./handlers/getFeed.js";
import { initCollectionsBackend } from "../collections.js";
import type { AnswerResult } from "../../../common/askQuestion.js";

// Only listFeeds is stubbed; storeFor/toDetail/deriveItems/pageResult stay real.
vi.mock("@mulmoclaude/core/feeds/server", () => ({ listFeeds: vi.fn(), readFeedState: vi.fn() }));

// A feed is a LoadedCollection with an `ingest` block. dataDir points at a real
// temp dir so the real file store reads the records off disk.
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
    // The file store resolves against the configured collection host's workspace root.
    initCollectionsBackend({ workspace: ws });
    // Records live at the real feed layout, <ws>/data/feeds/<slug>.
    dataDir = path.join(ws, "data", "feeds", "news");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, "item1.json"), JSON.stringify({ id: "1", title: "First" }));
    writeFileSync(path.join(dataDir, "item2.json"), JSON.stringify({ id: "2", title: "Second" }));
    handlers = createRemoteHostHandlers({
      workspace: ws,
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanupStaging: async () => {} }),
      spawnIssueSeed: () => "unused-session",
      listTerminalSessions: async () => ({ sessions: [], icons: {} }),
      captureTerminalScreen: async () => ({ screen: "", suggestion: "", quickCommands: [] }),
      captureTerminalTranscript: async () => ({ status: "none" as const }),
      writeToSession: () => false,
      canClearBox: () => false,
      submitSequence: () => "\r",
      sessionAgent: () => "claude" as const,
      launchTerminal: async () => ({ ok: true }) as const,
      openQuestion: async () => null,
      answerQuestion: async (): Promise<AnswerResult> => ({ ok: true }),
    });
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

// A feed whose records live somewhere other than `<dataDir>/*.json` — a dataSource
// CSV, a SQLite file. The on-disk fixture above cannot express one (the CSV store
// needs DuckDB), so the seam is stubbed instead: what matters is that the handler
// asks `listRecords` for the records and never reads the dataDir itself.
describe("createGetFeed · store seam", () => {
  const feedDeps = (all: Record<string, unknown>[]): GetFeedDeps => ({
    listFeeds: (async () => [
      { slug: "news", dataDir: "/nonexistent/news", schema: { primaryKey: "id", fields: { id: { type: "string" } } } },
    ]) as unknown as GetFeedDeps["listFeeds"],
    listRecords: (async () => all) as unknown as GetFeedDeps["listRecords"],
    toDetail: ((feed: { slug: string }) => ({
      slug: feed.slug,
      title: feed.slug,
      icon: "rss",
      source: "feed",
      schema: {},
    })) as unknown as GetFeedDeps["toDetail"],
    workspaceRoot: "/ws",
  });

  it("pages records the dataDir does not hold", async () => {
    const handler = createGetFeed(feedDeps([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]));
    const result = (await handler({ slug: "news", offset: 0, limit: 3 })) as unknown as { items: unknown[]; total: number; collection: { slug: string } };
    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(3);
    expect(result.collection.slug).toBe("news");
  });

  it("throws when the feed slug is not in the registry", async () => {
    const handler = createGetFeed(feedDeps([{ id: "a" }]));
    await expect(handler({ slug: "ghost" })).rejects.toThrow(/feed 'ghost' not found/);
  });

  it("passes the workspace root it was built with to the registry", async () => {
    const seen: unknown[] = [];
    const handler = createGetFeed({
      ...feedDeps([{ id: "a" }]),
      listFeeds: (async (root: string) => {
        seen.push(root);
        return [{ slug: "news", dataDir: "/nonexistent/news", schema: { primaryKey: "id", fields: {} } }];
      }) as unknown as GetFeedDeps["listFeeds"],
    });
    await handler({ slug: "news" });
    expect(seen).toEqual(["/ws"]);
  });
});
