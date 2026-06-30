// Server-side backend for @mulmoclaude/core/feeds. MulmoTerminal drives the collection
// "Refresh" button through the shared feeds engine — the same one MulmoClaude uses:
//   - declarative feeds (ingest.kind rss/atom/http-json) fetch + parse + upsert records
//     directly (no agent), and
//   - agent-ingest collections (ingest.kind:"agent") dispatch a VISIBLE worker session
//     the user can watch.
// Mirrors MulmoClaude's server/workspace/feeds/configure.ts + the refresh route. Like the
// accounting/collection backends, this is a thin host adapter: all logic lives in the
// package; we supply the workspace, an atomic writer, a logger, and the worker spawner.
//
// `spawnWorker` is INJECTED from server/index.ts (where the PTY spawn lives) so this
// backend never imports the session layer — the same workspace→routes-cycle avoidance
// MulmoClaude's host shim documents.
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { configureFeedsHost, refreshOne, listFeeds, readFeedState, removeFeed, type AgentWorkerRunner, type FeedsLogger } from "@mulmoclaude/core/feeds/server";
import { loadCollection } from "@mulmoclaude/core/collection/server";
import type { FeedSummary } from "@mulmoclaude/core/collection";

const log: FeedsLogger = {
  error: (prefix, msg, data) => console.error(`[${prefix}] ${msg}`, data ?? ""),
  warn: (prefix, msg, data) => console.warn(`[${prefix}] ${msg}`, data ?? ""),
  info: (prefix, msg, data) => console.log(`[${prefix}] ${msg}`, data ?? ""),
  debug: (prefix, msg, data) => console.debug(`[${prefix}] ${msg}`, data ?? ""),
};

// Atomic state-file write (feeds/<slug>/_state.json, data/ingest-state/<slug>.json):
// write a unique temp then rename, mkdir -p the parent first. Matches the engine's
// expectation of a plain (filePath, content) atomic writer.
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, filePath);
}

let workspaceRoot = "";

/** Wire the feeds engine to the shared workspace. Call once at boot, after pubsub +
 *  the collection backend. `spawnWorker` is supplied by server/index.ts. */
export function initFeedsBackend(deps: { workspace: string; spawnWorker: AgentWorkerRunner }): void {
  workspaceRoot = deps.workspace;
  configureFeedsHost({ workspaceRoot: deps.workspace, log, writeFileAtomic, spawnWorker: deps.spawnWorker });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// One feeds-index row: the registered feed's schema + its last-fetch state.
async function toFeedSummary(feed: Awaited<ReturnType<typeof listFeeds>>[number]): Promise<FeedSummary> {
  const state = await readFeedState(workspaceRoot, feed);
  const ingest = feed.schema.ingest;
  return {
    slug: feed.slug,
    title: feed.schema.title,
    icon: feed.schema.icon,
    kind: ingest?.kind ?? "rss",
    schedule: ingest?.schedule ?? "on-demand",
    lastFetchedAt: state.lastFetchedAt,
  };
}

/** Mount POST /api/collections/:slug/refresh — generic over ingest.kind (the engine
 *  dispatches declarative vs agent). Ports MulmoClaude's collections-route refresh
 *  handler; `hidden:false` so an agent-ingest refresh runs as a visible, watchable
 *  session. Backs the collection-view Refresh button (collectionUi.refreshCollection). */
export function mountFeedsRoutes(app: Express): void {
  // The feeds index (data-source collections in the workspace's feeds/ registry),
  // each enriched with its last-fetch state. Backs collectionUi.listFeeds.
  app.get("/api/feeds", async (_req: Request, res: Response) => {
    try {
      const feeds = await listFeeds(workspaceRoot);
      res.json({ feeds: await Promise.all(feeds.map(toFeedSummary)) });
    } catch (err) {
      log.warn("feeds", "list failed", { error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Remove a feed's registry entry (its records under dataPath are kept).
  app.delete("/api/feeds/:slug", async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const removed = await removeFeed(workspaceRoot, req.params.slug);
      res.json({ removed });
    } catch (err) {
      log.warn("feeds", "delete failed", { slug: req.params.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post("/api/collections/:slug/refresh", async (req: Request<{ slug: string }>, res: Response) => {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    if (!collection.schema.ingest) {
      res.status(400).json({ error: `collection '${collection.slug}' is not a feed (no ingest config)` });
      return;
    }
    try {
      const result = await refreshOne(workspaceRoot, collection, { hidden: false });
      res.json({ refreshed: true, written: result.written, errors: result.errors, dispatched: result.dispatched, chatId: result.chatId });
    } catch (err) {
      log.warn("feeds", "refresh failed", { slug: collection.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
