// Server-side backend for @mulmoclaude/core/feeds. MulmoTerminal drives the collection
// "Refresh" button through the shared feeds engine — the same one MulmoClaude uses:
//   - declarative feeds (ingest.kind rss/atom/http-json) fetch + parse + upsert records
//     directly (no agent), and
//   - agent-ingest collections (ingest.kind:"agent") dispatch a VISIBLE worker session
//     the user can watch.
// The route this file mounts answers for one more kind the feeds engine knows nothing about:
// the SAME button says "Sync" on a `googleCalendar` collection, and that arm lives in
// calendarRefresh.ts. One route because the plugin has one button.
// Mirrors MulmoClaude's server/workspace/feeds/configure.ts + the refresh route. Like the
// accounting/collection backends, this is a thin host adapter: all logic lives in the
// package; we supply the workspace, an atomic writer, a logger, and the worker spawner.
//
// `spawnWorker` is INJECTED from server/index.ts (where the PTY spawn lives) so this
// backend never imports the session layer — the same workspace→routes-cycle avoidance
// MulmoClaude's host shim documents.
import type { Express, Request, Response } from "express";
import { configureFeedsHost, refreshOne, listFeeds, readFeedState, removeFeed, type AgentWorkerRunner, type FeedsLogger } from "@mulmoclaude/core/feeds/server";
import { loadCollection, type LoadedCollection } from "@mulmoclaude/core/collection/server";
import type { FeedSummary } from "@mulmoclaude/core/collection";
import { writeFileAtomic } from "../files/atomic-write.js";
import { feedSummary } from "./feed-summary.js";
import { errorStatus, resolveProjectRoot } from "../infra/project-root.js";
import { syncCalendarCollection } from "./calendarRefresh.js";
import type { CollectionRefreshResult } from "../../common/collectionRefresh.js";

const log: FeedsLogger = {
  error: (prefix, msg, data) => console.error(`[${prefix}] ${msg}`, data ?? ""),
  warn: (prefix, msg, data) => console.warn(`[${prefix}] ${msg}`, data ?? ""),
  info: (prefix, msg, data) => console.log(`[${prefix}] ${msg}`, data ?? ""),
  debug: (prefix, msg, data) => console.debug(`[${prefix}] ${msg}`, data ?? ""),
};

/** Wire the feeds engine to the shared workspace. Call once at boot, after pubsub +
 *  the collection backend. `spawnWorker` is supplied by server/index.ts.
 *
 *  No module-level root is kept any more: every route on the collection surface resolves its own
 *  (`resolveProjectRoot`), and a second copy of "the root" is what let one route answer for a
 *  project while the helper beside it answered for the workspace. */
export function initFeedsBackend(deps: { workspace: string; spawnWorker: AgentWorkerRunner }): void {
  configureFeedsHost({ workspaceRoot: deps.workspace, log, writeFileAtomic, spawnWorker: deps.spawnWorker });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// One feeds-index row: the registered feed's schema + its last-fetch state.
//
// The ROOT is passed in. Reading the module-level workspace here made a project's feeds report
// the workspace feed's `lastFetchedAt` — or none at all — while the row beside it came from the
// project: one list, two roots, and no way to tell which number belonged to which.
async function toFeedSummary(root: string, feed: Awaited<ReturnType<typeof listFeeds>>[number]): Promise<FeedSummary> {
  const state = await readFeedState(root, feed);
  return feedSummary(feed, state.lastFetchedAt);
}

/** The `ingest` arm. Generic over `ingest.kind` — the engine dispatches declarative vs agent —
 *  and `hidden:false` so an agent-ingest refresh runs as a visible session the user can watch
 *  and debug. Scheduled refreshes stay hidden; declarative feeds ignore the flag.
 *
 *  `removed` is deliberately not reported: the engine counts its `maxItems` evictions, this arm
 *  has never sent them, and MulmoClaude's does not either — so the field means "a calendar sync
 *  deleted records" on both hosts rather than two things on one.
 */
async function refreshFeed(root: string, collection: LoadedCollection): Promise<CollectionRefreshResult> {
  const result = await refreshOne(root, collection, { hidden: false });
  return {
    refreshed: true,
    written: result.written,
    errors: result.errors,
    // A declarative feed dispatches nothing, and the key is OMITTED rather than set to
    // `undefined` — that is what the wire carries after JSON.stringify either way, and it is what
    // keeps this response assignable to the shape the view declares.
    ...(result.dispatched === undefined ? {} : { dispatched: result.dispatched }),
    ...(result.chatId === undefined ? {} : { chatId: result.chatId }),
  };
}

/** Mount POST /api/collections/:slug/refresh — a feed's `ingest` re-run or a `googleCalendar`
 *  sync, whichever the schema declares. Ports MulmoClaude's collections-route refresh handler,
 *  both arms. Backs the collection-view Refresh/Sync button (collectionUi.refreshCollection). */
export function mountFeedsRoutes(app: Express): void {
  // The feeds index (data-source collections in the workspace's feeds/ registry),
  // each enriched with its last-fetch state. Backs collectionUi.listFeeds.
  app.get("/api/feeds", async (req: Request, res: Response) => {
    try {
      // Feeds live under `<root>/feeds`, so they follow the named project like collections do —
      // a collections surface showing one project's cards beside another's feeds would be a
      // list nobody could reason about.
      const root = resolveProjectRoot(req).workspaceRoot;
      const feeds = await listFeeds(root);
      res.json({ feeds: await Promise.all(feeds.map((feed) => toFeedSummary(root, feed))) });
    } catch (err) {
      log.warn("feeds", "list failed", { error: errorMessage(err) });
      res.status(errorStatus(err)).json({ error: errorMessage(err) });
    }
  });

  // Remove a feed's registry entry (its records under dataPath are kept).
  app.delete("/api/feeds/:slug", async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const removed = await removeFeed(resolveProjectRoot(req).workspaceRoot, req.params.slug);
      res.json({ removed });
    } catch (err) {
      log.warn("feeds", "delete failed", { slug: req.params.slug, error: errorMessage(err) });
      res.status(errorStatus(err)).json({ error: errorMessage(err) });
    }
  });

  // Sits on the collection surface, so it honours `?project=` like the rest of it. Reading the
  // module-level workspace here instead would refresh — and WRITE — the workspace collection
  // that happens to share the slug, or 404 while the named project holds the feed.
  app.post("/api/collections/:slug/refresh", async (req: Request<{ slug: string }>, res: Response) => {
    let scope;
    try {
      scope = resolveProjectRoot(req);
    } catch (err) {
      res.status(errorStatus(err)).json({ error: errorMessage(err) });
      return;
    }
    const collection = await loadCollection(req.params.slug, scope);
    if (!collection) {
      res.status(404).json({ error: `collection '${req.params.slug}' not found` });
      return;
    }
    // An ordinary skill collection retrieves nothing, so there is no refresh to run. The button
    // is not offered for one either — the plugin gates it on the same two blocks.
    if (!collection.schema.ingest && !collection.schema.googleCalendar) {
      res.status(400).json({ error: `collection '${collection.slug}' is not refreshable (no ingest or googleCalendar config)` });
      return;
    }
    try {
      // `ingest` wins when a schema declares both — MulmoClaude's pre-existing precedence, kept
      // so one schema cannot mean two things depending on which host opened it.
      res.json(
        collection.schema.ingest ? await refreshFeed(scope.workspaceRoot, collection) : await syncCalendarCollection(collection.slug, scope.workspaceRoot),
      );
    } catch (err) {
      log.warn("feeds", "refresh failed", { slug: collection.slug, error: errorMessage(err) });
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
