// Typed client for the read-only wiki REST surface (server/backends/wiki.ts). Thin
// fetch wrappers — the heavy lifting (slug resolution, graph, lint) all lives in the
// shared @mulmoclaude/core engine the server calls; the browser only renders the
// shapes it returns. Types mirror @mulmoclaude/core/wiki(/server) so the views stay
// in lockstep with the engine.
import type { WikiPageEntry, WikiGraph } from "@mulmoclaude/core/wiki";

/** index.md raw content + its parsed page entries (GET /api/wiki). */
export interface WikiIndex {
  content: string;
  entries: WikiPageEntry[];
}

/** A single resolved page (GET /api/wiki?slug=). `exists: false` is returned for a
 *  404 so callers can render the not-found state without a throw. */
export interface WikiPage {
  filePath: string | null;
  content: string;
  exists: boolean;
  resolvedTitle: string;
}

/** Lint issues + the rendered markdown report (GET /api/wiki/lint). */
export interface WikiLint {
  issues: string[];
  report: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export function fetchWikiIndex(): Promise<WikiIndex> {
  return getJson<WikiIndex>("/api/wiki");
}

/** Fetch one page. A 404 resolves to an `exists: false` page rather than throwing,
 *  so the view can show "page not found"; other errors still throw. */
export async function fetchWikiPage(slug: string): Promise<WikiPage> {
  const res = await fetch(`/api/wiki?slug=${encodeURIComponent(slug)}`);
  if (res.status === 404) return { filePath: null, content: "", exists: false, resolvedTitle: slug };
  if (!res.ok) throw new Error(`/api/wiki?slug=${slug} → ${res.status}`);
  return (await res.json()) as WikiPage;
}

export function fetchWikiGraph(): Promise<WikiGraph> {
  return getJson<WikiGraph>("/api/wiki/graph");
}

export function fetchWikiLint(): Promise<WikiLint> {
  return getJson<WikiLint>("/api/wiki/lint");
}
