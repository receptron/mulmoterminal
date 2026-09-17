// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import { tmpdir } from "node:os";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { initFeedsBackend, mountFeedsRoutes } from "../../../server/backends/feeds.js";
import { initProjectRoots, projectId } from "../../../server/infra/project-root.js";
import { makeTempDir } from "../../support/tempDir";
import { listFeeds, readFeedState, removeFeed, refreshOne } from "@mulmoclaude/core/feeds/server";
import { loadCollection } from "@mulmoclaude/core/collection/server";
import { syncCalendarCollection } from "../../../server/backends/calendarRefresh.js";

// The feeds engine reads the workspace + fetches sources — mock it so the route
// tests run offline and we assert the host glue (FeedSummary shaping, status).
vi.mock("@mulmoclaude/core/feeds/server", () => ({
  configureFeedsHost: vi.fn(),
  refreshOne: vi.fn(),
  listFeeds: vi.fn(),
  readFeedState: vi.fn(),
  removeFeed: vi.fn(),
}));

// The refresh route admits a slug through the collection engine and, for a calendar, hands it
// to the arm in calendarRefresh.ts. Both are mocked: this file pins WHICH arm a schema reaches
// and what the route answers when it reaches neither. The calendar arm's own contract — the
// engine call and the counts it reports — is calendarRefresh.spec.ts + calendarRefreshResult.spec.ts.
vi.mock("@mulmoclaude/core/collection/server", () => ({ loadCollection: vi.fn() }));
vi.mock("../../../server/backends/calendarRefresh.js", () => ({ syncCalendarCollection: vi.fn() }));

let request: ReturnType<typeof appRequest>;
// The engine is mocked, so this path is only passed through (never read on disk).
const ws = path.join(tmpdir(), "mt-feeds-ws");
// A SECOND root, registered as a named project. It has to be a real directory because
// `resolveProjectRoot` matches an id against the known projects by real path. Without it the
// refresh specs run with one root wearing two hats — the workspace AND the request's scope — and
// a regression to the module-level workspace passes every one of them (Codex round 2, P2).
const projectRoot = makeTempDir("mt-feeds-project-");

beforeAll(() => {
  // The feed routes sit on the collection surface and resolve their root per request now, so
  // they need the same binding every collection route needs.
  initProjectRoots({ workspace: ws, knownProjects: () => [{ label: "project", path: projectRoot }] });
  initFeedsBackend({ workspace: ws, spawnWorker: vi.fn() as never });
  const app = express();
  app.use(express.json());
  mountFeedsRoutes(app);
  request = appRequest(app);
});

describe("GET /api/feeds", () => {
  beforeEach(() => {
    vi.mocked(listFeeds).mockReset();
    vi.mocked(readFeedState).mockReset();
  });

  it("shapes each registered feed into a FeedSummary with its last-fetch state", async () => {
    vi.mocked(listFeeds).mockResolvedValue([{ slug: "news", schema: { title: "News", icon: "rss", ingest: { kind: "rss", schedule: "hourly" } } }] as never);
    vi.mocked(readFeedState).mockResolvedValue({ lastFetchedAt: "2026-07-01T00:00:00Z" } as never);
    const res = await request("/api/feeds");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      feeds: [{ slug: "news", title: "News", icon: "rss", kind: "rss", schedule: "hourly", lastFetchedAt: "2026-07-01T00:00:00Z" }],
    });
  });

  it("defaults kind/schedule when a feed declares no ingest config", async () => {
    vi.mocked(listFeeds).mockResolvedValue([{ slug: "x", schema: { title: "X", icon: "star" } }] as never);
    vi.mocked(readFeedState).mockResolvedValue({ lastFetchedAt: null } as never);
    const res = await request("/api/feeds");
    const body = (await res.json()) as { feeds: Array<{ kind: string; schedule: string; lastFetchedAt: string | null }> };
    expect(body.feeds[0]).toMatchObject({ kind: "rss", schedule: "on-demand", lastFetchedAt: null });
  });

  it("500s when the engine throws", async () => {
    vi.mocked(listFeeds).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    expect((await request("/api/feeds")).status).toBe(500);
  });
});

describe("DELETE /api/feeds/:slug", () => {
  beforeEach(() => vi.mocked(removeFeed).mockReset());

  it("removes the feed and reports whether an entry existed", async () => {
    vi.mocked(removeFeed).mockResolvedValue(true as never);
    const res = await request("/api/feeds/news", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(vi.mocked(removeFeed)).toHaveBeenCalledWith(ws, "news");
  });

  it("500s when removal throws", async () => {
    vi.mocked(removeFeed).mockImplementationOnce(async () => {
      throw new Error("io");
    });
    expect((await request("/api/feeds/news", { method: "DELETE" })).status).toBe(500);
  });
});

// The button the plugin shows on a collection header is ONE button with two labels: "Refresh"
// when the schema declares `ingest`, "Sync" when it declares `googleCalendar`. It posts here
// either way, and there is no way for a host to hide it — so a schema the route refuses is a
// button that can only fail. That is what #2108 was: the calendar arm was never wired, and every
// press on a calendar collection came back 400.
describe("POST /api/collections/:slug/refresh", () => {
  const withSchema = (schema: Record<string, unknown>) => vi.mocked(loadCollection).mockResolvedValue({ slug: "cal", schema } as never);
  const refresh = (slug = "cal") =>
    request(`/api/collections/${slug}/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

  beforeEach(() => {
    vi.mocked(loadCollection).mockReset();
    vi.mocked(refreshOne).mockReset();
    vi.mocked(syncCalendarCollection).mockReset();
  });

  it("syncs a googleCalendar collection and answers the sync's counts", async () => {
    withSchema({ title: "Cal", googleCalendar: { calendarId: "primary", map: {} } });
    vi.mocked(syncCalendarCollection).mockResolvedValue({ refreshed: true, written: 3, removed: 1, errors: [] });
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refreshed: true, written: 3, removed: 1, errors: [] });
    // The REQUEST's root, not the module's: this host serves several, and the lookup that
    // admitted the slug resolved the same one.
    expect(vi.mocked(syncCalendarCollection)).toHaveBeenCalledWith("cal", ws);
    expect(vi.mocked(refreshOne)).not.toHaveBeenCalled();
  });

  it("refreshes a feed through the feeds engine", async () => {
    withSchema({ title: "News", ingest: { kind: "rss", schedule: "hourly" } });
    vi.mocked(refreshOne).mockResolvedValue({ slug: "cal", written: 2, removed: 0, errors: [] } as never);
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refreshed: true, written: 2, errors: [] });
    // Visible, so an agent-ingest run is a session the user can open and watch.
    expect(vi.mocked(refreshOne)).toHaveBeenCalledWith(ws, expect.anything(), { hidden: false });
    expect(vi.mocked(syncCalendarCollection)).not.toHaveBeenCalled();
  });

  it("carries a dispatched agent-ingest session back to the view", async () => {
    withSchema({ title: "News", ingest: { kind: "agent", schedule: "hourly" } });
    vi.mocked(refreshOne).mockResolvedValue({ slug: "cal", written: 0, removed: 0, errors: [], dispatched: true, chatId: "chat-7" } as never);
    expect(await (await refresh()).json()).toEqual({ refreshed: true, written: 0, errors: [], dispatched: true, chatId: "chat-7" });
  });

  // `dispatched: false` is a VALUE the engine sends, not an absent field, so the arm must key on
  // `=== undefined` and not on truthiness. Simplifying that condition to `result.dispatched ? …`
  // drops the key here and changes the response — and every other case in this file survives it,
  // which is why this one is spelled out.
  it("keeps a dispatched:false the engine sent, rather than treating it as absent", async () => {
    withSchema({ title: "News", ingest: { kind: "rss", schedule: "hourly" } });
    vi.mocked(refreshOne).mockResolvedValue({ slug: "cal", written: 1, removed: 0, errors: [], dispatched: false } as never);
    expect(await (await refresh()).json()).toEqual({ refreshed: true, written: 1, errors: [], dispatched: false });
  });

  // One schema must not mean two things depending on which host opened it: MulmoClaude's route
  // has always taken `ingest` first, so this one does too.
  it("takes the ingest arm when a schema declares both", async () => {
    withSchema({ title: "Both", ingest: { kind: "rss", schedule: "hourly" }, googleCalendar: { calendarId: "primary", map: {} } });
    vi.mocked(refreshOne).mockResolvedValue({ slug: "cal", written: 1, removed: 0, errors: [] } as never);
    expect((await refresh()).status).toBe(200);
    expect(vi.mocked(syncCalendarCollection)).not.toHaveBeenCalled();
  });

  // The root comes from the REQUEST, not from the module — this host serves several, while the
  // reference host has one. Both calls must land on the SAME root: a lookup that admits a slug in
  // one project while the sync runs against another answers for a collection nobody asked about.
  //
  // This is the only test here where the workspace and the request's root differ, which is the
  // whole point of it: with one root, reverting either call to the module workspace is invisible.
  it("resolves both the lookup and the sync against the named project's root", async () => {
    withSchema({ title: "Cal", googleCalendar: { calendarId: "primary", map: {} } });
    vi.mocked(syncCalendarCollection).mockResolvedValue({ refreshed: true, written: 1, errors: [] });
    const res = await request(`/api/collections/cal/refresh?project=${projectId(projectRoot)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(loadCollection)).toHaveBeenCalledWith("cal", { workspaceRoot: projectRoot });
    expect(vi.mocked(syncCalendarCollection)).toHaveBeenCalledWith("cal", projectRoot);
  });

  // The feed arm carries the same obligation, and it is a separate call site.
  it("resolves the feed refresh against the named project's root too", async () => {
    withSchema({ title: "News", ingest: { kind: "rss", schedule: "hourly" } });
    vi.mocked(refreshOne).mockResolvedValue({ slug: "cal", written: 0, removed: 0, errors: [] } as never);
    const res = await request(`/api/collections/cal/refresh?project=${projectId(projectRoot)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(loadCollection)).toHaveBeenCalledWith("cal", { workspaceRoot: projectRoot });
    expect(vi.mocked(refreshOne)).toHaveBeenCalledWith(projectRoot, expect.anything(), { hidden: false });
  });

  // An ordinary skill collection retrieves nothing, and the plugin offers it no button either.
  it("400s a collection that declares neither, naming both", async () => {
    withSchema({ title: "Notes" });
    const res = await refresh();
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("ingest");
    expect(error).toContain("googleCalendar");
  });

  it("404s an unknown slug without reaching either arm", async () => {
    vi.mocked(loadCollection).mockResolvedValue(null as never);
    expect((await refresh("nope")).status).toBe(404);
    expect(vi.mocked(refreshOne)).not.toHaveBeenCalled();
    expect(vi.mocked(syncCalendarCollection)).not.toHaveBeenCalled();
  });

  it("500s when the calendar arm throws", async () => {
    withSchema({ title: "Cal", googleCalendar: { calendarId: "primary", map: {} } });
    vi.mocked(syncCalendarCollection).mockImplementationOnce(async () => {
      throw new Error("workspace unreadable");
    });
    const res = await refresh();
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: "workspace unreadable" });
  });
});
