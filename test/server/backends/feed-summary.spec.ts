// @vitest-environment node
import { describe, it, expect } from "vitest";

import { feedSummary, type FeedLike } from "../../../server/backends/feed-summary.js";

const feed = (over: Partial<FeedLike["schema"]> = {}): FeedLike => ({
  slug: "news",
  schema: { title: "News", icon: "rss_feed", ...over },
});

describe("feedSummary", () => {
  it("carries the feed's own kind and schedule when it declares an ingest block", () => {
    const s = feedSummary(feed({ ingest: { kind: "agent", schedule: "daily" } }), "2026-07-23T00:00:00Z");
    expect(s).toEqual({ slug: "news", title: "News", icon: "rss_feed", kind: "agent", schedule: "daily", lastFetchedAt: "2026-07-23T00:00:00Z" });
  });

  // The defaulting the two copies had to agree on: a feed with no ingest block still shows a
  // kind and a schedule on BOTH the desktop route and the phone channel.
  it("defaults a feed with no ingest to rss / on-demand", () => {
    const s = feedSummary(feed(), null);
    expect([s.kind, s.schedule]).toEqual(["rss", "on-demand"]);
  });

  it("defaults each field independently", () => {
    expect(feedSummary(feed({ ingest: { schedule: "hourly" } }), null).kind).toBe("rss");
    expect(feedSummary(feed({ ingest: { kind: "agent" } }), null).schedule).toBe("on-demand");
  });

  it("passes a null last-fetch time through", () => {
    expect(feedSummary(feed(), null).lastFetchedAt).toBeNull();
  });
});
