// The Library's reads (#3329): /api/library/* answered as checked values, or null for any failure —
// a 503 while the index cannot be opened, a timeout, or a body that is not the wire shape.
import { isUnknownArray } from "../../common/isUnknownArray";
import {
  isLibraryConversation,
  isLibraryIndexStatus,
  isLibrarySearchHit,
  type LibraryConversation,
  type LibraryIndexStatus,
  type LibrarySearchHit,
} from "../../common/library";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

/** The index answers a page from what it holds, but a first open also starts the worker. */
const LIBRARY_READ_TIMEOUT_MS = 15_000;
export const LIBRARY_PAGE = 50;

async function readJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchWithTimeout(url, signal ? { signal } : undefined, LIBRARY_READ_TIMEOUT_MS);
    return response.ok ? await jsonBody(response) : null;
  } catch {
    return null;
  }
}

export async function loadLibraryStatus(): Promise<LibraryIndexStatus | null> {
  const body = await readJson("/api/library/status");
  return isLibraryIndexStatus(body) ? body : null;
}

export interface LibraryPage {
  conversations: LibraryConversation[];
  hasMore: boolean;
}

export async function loadLibraryPage(offset: number): Promise<LibraryPage | null> {
  const body = await readJson(`/api/library/conversations?offset=${String(offset)}&limit=${String(LIBRARY_PAGE)}`);
  if (body === null || !isUnknownArray(body.conversations)) return null;
  return { conversations: body.conversations.filter(isLibraryConversation), hasMore: body.hasMore === true };
}

export async function searchLibrary(query: string, signal: AbortSignal): Promise<LibrarySearchHit[] | null> {
  const body = await readJson(`/api/library/search?q=${encodeURIComponent(query)}&limit=${String(LIBRARY_PAGE)}`, signal);
  return body !== null && isUnknownArray(body.hits) ? body.hits.filter(isLibrarySearchHit) : null;
}
