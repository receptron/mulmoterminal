// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest.js";
import express from "express.js";
import { tmpdir } from "node:os.js";
import path from "node:path.js";
import type { Server } from "node:http.js";
import { initFeedsBackend, mountFeedsRoutes } from "../../../server/backends/feeds.js";
import { listFeeds, readFeedState, removeFeed } from "@mulmoclaude/core/feeds/server.js";

// The feeds engine reads the workspace + fetches sources — mock it so the route
// tests run offline and we assert the host glue (FeedSummary shaping, status).
vi.mock("@mulmoclaude/core/feeds/server", () => ({
  configureFeedsHost: vi.fn(),
  refreshOne: vi.fn(),
  listFeeds: vi.fn(),
  readFeedState: vi.fn(),
  removeFeed: vi.fn(),
}));

let server: Server;
let base: string;
// The engine is mocked, so this path is only passed through (never read on disk).
const ws = path.join(tmpdir(), "mt-feeds-ws");

beforeAll(async () => {
  initFeedsBackend({ workspace: ws, spawnWorker: vi.fn() as never });
  const app = express();
  app.use(express.json());
  mountFeedsRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => server?.close());

describe("GET /api/feeds", () => {
  beforeEach(() => {
    vi.mocked(listFeeds).mockReset();
    vi.mocked(readFeedState).mockReset();
  });

  it("shapes each registered feed into a FeedSummary with its last-fetch state", async () => {
    vi.mocked(listFeeds).mockResolvedValue([{ slug: "news", schema: { title: "News", icon: "rss", ingest: { kind: "rss", schedule: "hourly" } } }] as never);
    vi.mocked(readFeedState).mockResolvedValue({ lastFetchedAt: "2026-07-01T00:00:00Z" } as never);
    const res = await fetch(`${base}/api/feeds`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      feeds: [{ slug: "news", title: "News", icon: "rss", kind: "rss", schedule: "hourly", lastFetchedAt: "2026-07-01T00:00:00Z" }],
    });
  });

  it("defaults kind/schedule when a feed declares no ingest config", async () => {
    vi.mocked(listFeeds).mockResolvedValue([{ slug: "x", schema: { title: "X", icon: "star" } }] as never);
    vi.mocked(readFeedState).mockResolvedValue({ lastFetchedAt: null } as never);
    const res = await fetch(`${base}/api/feeds`);
    const body = (await res.json()) as { feeds: Array<{ kind: string; schedule: string; lastFetchedAt: string | null }> };
    expect(body.feeds[0]).toMatchObject({ kind: "rss", schedule: "on-demand", lastFetchedAt: null });
  });

  it("500s when the engine throws", async () => {
    vi.mocked(listFeeds).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    expect((await fetch(`${base}/api/feeds`)).status).toBe(500);
  });
});

describe("DELETE /api/feeds/:slug", () => {
  beforeEach(() => vi.mocked(removeFeed).mockReset());

  it("removes the feed and reports whether an entry existed", async () => {
    vi.mocked(removeFeed).mockResolvedValue(true as never);
    const res = await fetch(`${base}/api/feeds/news`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(vi.mocked(removeFeed)).toHaveBeenCalledWith(ws, "news");
  });

  it("500s when removal throws", async () => {
    vi.mocked(removeFeed).mockImplementationOnce(async () => {
      throw new Error("io");
    });
    expect((await fetch(`${base}/api/feeds/news`, { method: "DELETE" })).status).toBe(500);
  });
});
