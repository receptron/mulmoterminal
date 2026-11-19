// The Library's index over HTTP (#3328). Read-only. Every call goes to the worker that owns the index,
// which also starts it catching up in the background, so a request after a long absence is answered
// fast and slightly behind rather than slowly. 503 when the index cannot be opened or does not answer.
import type { Express, Response } from "express";
import type { ConversationFilter } from "../backends/library/index-queries.js";
import { MAX_QUERY_CHARS } from "../backends/library/library-search.js";
import { createLibraryClient } from "../backends/library/library-client.js";
import type { LibraryCaller, LibraryMethod } from "../backends/library/library-service.js";

export const LIBRARY_PAGE_DEFAULT = 50;
export const LIBRARY_PAGE_MAX = 200;

export interface LibraryRouteDeps {
  /** Override the worker, for tests. */
  call?: LibraryCaller;
}

const flag = (value: unknown): boolean => value === "1" || value === "true";

/** A non-negative integer from a query string, clamped to `max`; `fallback` for anything else. */
export function queryCount(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : fallback;
  return Math.min(parsed, max);
}

export function filterOf(query: Record<string, unknown>): ConversationFilter {
  const cwd = typeof query.cwd === "string" && query.cwd !== "" ? query.cwd : undefined;
  return { ...(cwd === undefined ? {} : { cwd }), includeTemporary: flag(query.temporary), includeSidechains: flag(query.sidechains) };
}

let shared: LibraryCaller | null = null;
const sharedCaller: LibraryCaller = (method, args) => {
  shared ??= createLibraryClient().call;
  return shared(method, args);
};

async function answer(res: Response, call: LibraryCaller, method: LibraryMethod, args: unknown[]): Promise<unknown> {
  try {
    return await call(method, args);
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : "the library index is unavailable" });
    return undefined;
  }
}

export function mountLibraryRoutes(app: Express, deps: LibraryRouteDeps = {}): void {
  const call = deps.call ?? sharedCaller;
  const pageLimit = (value: unknown): number => queryCount(value, LIBRARY_PAGE_DEFAULT, LIBRARY_PAGE_MAX);
  app.get("/api/library/status", async (_req, res) => {
    const status = await answer(res, call, "status", []);
    if (status !== undefined) res.json(status);
  });
  app.get("/api/library/conversations", async (req, res) => {
    const offset = queryCount(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
    const page = await answer(res, call, "list", [filterOf(req.query), offset, pageLimit(req.query.limit)]);
    if (page !== undefined) res.json(page);
  });
  app.get("/api/library/conversations/:id", async (req, res) => {
    const conversation = await answer(res, call, "conversation", [req.params.id]);
    if (conversation === null) res.status(404).json({ error: "conversation not found" });
    else if (conversation !== undefined) res.json(conversation);
  });
  app.get("/api/library/search", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query === "" || query.length > MAX_QUERY_CHARS) {
      res.status(400).json({ error: `q must be 1-${String(MAX_QUERY_CHARS)} characters` });
      return;
    }
    const hits = await answer(res, call, "search", [query, filterOf(req.query), pageLimit(req.query.limit)]);
    if (hits !== undefined) res.json({ hits });
  });
}
