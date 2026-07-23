// One feeds-index row, from a registered feed's schema and its last-fetch state.
//
// The desktop route (feeds.ts) and the phone command channel (remoteHost/handlers.ts) both
// build this, and both had their own copy of the same defaulting: a feed that declares no
// `ingest` block still shows a kind and a schedule, `"rss"` and `"on-demand"`. Two copies
// documented as mirrors is how they drift — the two surfaces would then disagree on a feed's
// badge, or one would show `undefined` where the other shows a default.
import type { FeedSummary } from "@mulmoclaude/core/collection";

const DEFAULT_KIND = "rss";
const DEFAULT_SCHEDULE = "on-demand";

export interface FeedLike {
  slug: string;
  schema: { title: string; icon: string; ingest?: { kind?: string; schedule?: string } };
}

export function feedSummary(feed: FeedLike, lastFetchedAt: string | null): FeedSummary {
  return {
    slug: feed.slug,
    title: feed.schema.title,
    icon: feed.schema.icon,
    kind: feed.schema.ingest?.kind ?? DEFAULT_KIND,
    schedule: feed.schema.ingest?.schedule ?? DEFAULT_SCHEDULE,
    lastFetchedAt,
  };
}
