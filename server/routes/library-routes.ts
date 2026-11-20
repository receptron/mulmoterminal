// The Library's index over HTTP (#3328). Read-only. Every call goes to the worker that owns the index,
// which also starts it catching up in the background, so a request after a long absence is answered
// fast and slightly behind rather than slowly. 503 when the index cannot be opened or does not answer.
import type { Express, Response } from "express";
import type { ConversationFilter } from "../backends/library/index-queries.js";
import { MAX_QUERY_CHARS } from "../backends/library/library-search.js";
import { createLibraryClient } from "../backends/library/library-client.js";
import type { LibraryCaller, LibraryMethod } from "../backends/library/library-service.js";
import { changeLibraryMark, readLibraryMarks } from "../backends/library/library-marks.js";
import { isRepositoryName, LIBRARY_NAME_MAX, PR_CREATORS_MAX, type LibraryMarkChange } from "../../common/library.js";
import { requestBody } from "./requestBody.js";
import { claudeFileHistoryRoot, mountFileRoutes } from "./library-file-routes.js";

/** Path-safe and short: what a transcript's file name can be. Whether it names a conversation is the
 *  index's to say (a 404), since the index takes any `.jsonl` name, subagents' included. */
export const isMarkableId = (id: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);

export const LIBRARY_PAGE_DEFAULT = 50;
export const LIBRARY_PAGE_MAX = 200;

export interface LibraryRouteDeps {
  /** Override the worker, for tests. */
  call?: LibraryCaller;
  /** Override where pins and names live, for tests. */
  marksFile?: string;
  /** Override Claude Code's file-history directory, for tests. */
  fileHistoryRoot?: string;
}

const flag = (value: unknown): boolean => value === "1" || value === "true";

/** A non-negative integer from a query string, clamped to `max`; `fallback` for anything else. */
export function queryCount(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : fallback;
  return Math.min(parsed, max);
}

export function filterOf(query: Record<string, unknown>): ConversationFilter {
  const cwd = typeof query.cwd === "string" && query.cwd !== "" ? query.cwd : undefined;
  const flags = { includeTemporary: flag(query.temporary), includeSidechains: flag(query.sidechains), includeAutomated: flag(query.automated) };
  return { ...(cwd === undefined ? {} : { cwd }), ...flags };
}

let shared: LibraryCaller | null = null;
const sharedCaller: LibraryCaller = (method, args) => {
  shared ??= createLibraryClient().call;
  return shared(method, args);
};

export async function answer(res: Response, call: LibraryCaller, method: LibraryMethod, args: unknown[]): Promise<unknown> {
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
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd : "";
    const conversation = await answer(res, call, "conversation", [req.params.id, cwd]);
    if (conversation === null) res.status(404).json({ error: "conversation not found" });
    else if (conversation !== undefined) res.json(conversation);
  });
  mountMarkRoutes(app, call, deps.marksFile);
  mountFileRoutes(app, call, deps.fileHistoryRoot ?? claudeFileHistoryRoot());
  app.get("/api/library/search", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query === "" || query.length > MAX_QUERY_CHARS) {
      res.status(400).json({ error: `q must be 1-${String(MAX_QUERY_CHARS)} characters` });
      return;
    }
    const hits = await answer(res, call, "search", [query, filterOf(req.query), pageLimit(req.query.limit)]);
    if (hits !== undefined) res.json({ hits });
  });
  app.get("/api/library/pr-creators", async (req, res) => {
    const repository = typeof req.query.repo === "string" ? req.query.repo : "";
    const numbers = prNumbersOf(req.query.numbers);
    if (!isRepositoryName(repository) || numbers === null) {
      res.status(400).json({ error: `repo must be owner/repo, and numbers 1-${String(PR_CREATORS_MAX)} PR numbers` });
      return;
    }
    const creators = await answer(res, call, "prCreators", [repository, numbers]);
    if (creators !== undefined) res.json({ creators });
  });
}

/** `numbers=1,2,3`: positive PR numbers, at least one and at most the cap, or null. */
export function prNumbersOf(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const parts = value.split(",");
  if (!parts.every((part) => /^[1-9]\d{0,9}$/.test(part))) return null;
  const numbers = [...new Set(parts.map(Number))];
  return numbers.length <= PR_CREATORS_MAX ? numbers : null;
}

/** A change from a request body, or null when any field it carries is malformed — the whole request is
 *  refused rather than applied in part. A name past the cap is malformed too: the UI cannot send one. */
export function markChangeOf(body: Record<string, unknown>): LibraryMarkChange | null {
  const { pinned, name } = body;
  if (pinned !== undefined && typeof pinned !== "boolean") return null;
  if (name !== undefined && name !== null && (typeof name !== "string" || name.length > LIBRARY_NAME_MAX)) return null;
  if (pinned === undefined && name === undefined) return null;
  return { ...(pinned === undefined ? {} : { pinned }), ...(name === undefined ? {} : { name }) };
}

// Pins and names live in MulmoTerminal's own file, not in the index, so they are read and written
// here rather than on the worker. 500 when the file exists but cannot be read: answering "none"
// would let the next change overwrite what the user had.
function mountMarkRoutes(app: Express, call: LibraryCaller, marksFile: string | undefined): void {
  app.get("/api/library/marks", async (_req, res) => {
    try {
      res.json(await readLibraryMarks(marksFile));
    } catch {
      res.status(500).json({ error: "the marks could not be read" }); // the error names the file path
    }
  });
  app.put("/api/library/marks/:id", async (req, res) => {
    const change = markChangeOf(requestBody(req.body));
    if (change === null || !isMarkableId(req.params.id)) {
      res.status(400).json({ error: "expected { pinned?: boolean, name?: string | null } for a session id" });
      return;
    }
    // Only a conversation the index holds: a mark for anything else would sit in the file unseen.
    const known = await answer(res, call, "conversation", [req.params.id]);
    if (known === undefined) return;
    if (known === null) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    try {
      res.json(await changeLibraryMark(req.params.id, change, marksFile));
    } catch {
      res.status(500).json({ error: "the marks could not be saved" });
    }
  });
}
