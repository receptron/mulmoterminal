// The Library's reads (#3329): /api/library/* answered as checked values, or null for any failure —
// a 503 while the index cannot be opened, a timeout, or a body that is not the wire shape.
import { isUnknownArray } from "../../common/isUnknownArray";
import { isLibraryFileText, isLibraryTrackedFile, type LibraryFileText, type LibraryTrackedFile } from "../../common/libraryFiles";
import {
  isLibraryConversation,
  isLibraryPrCreator,
  PR_CREATORS_MAX,
  type LibraryPrCreator,
  isLibraryIndexStatus,
  isLibraryMarks,
  isLibrarySearchHit,
  type LibraryConversation,
  type LibraryIndexStatus,
  type LibraryMarkChange,
  type LibraryMarks,
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
  indexFinishedAt: number | null;
}

export async function loadLibraryPage(offset: number): Promise<LibraryPage | null> {
  const body = await readJson(`/api/library/conversations?offset=${String(offset)}&limit=${String(LIBRARY_PAGE)}`);
  if (body === null || !isUnknownArray(body.conversations)) return null;
  const indexFinishedAt = typeof body.indexFinishedAt === "number" ? body.indexFinishedAt : null;
  return { conversations: body.conversations.filter(isLibraryConversation), hasMore: body.hasMore === true, indexFinishedAt };
}

export async function searchLibrary(query: string, signal: AbortSignal): Promise<LibrarySearchHit[] | null> {
  const body = await readJson(`/api/library/search?q=${encodeURIComponent(query)}&limit=${String(LIBRARY_PAGE)}`, signal);
  return body !== null && isUnknownArray(body.hits) ? body.hits.filter(isLibrarySearchHit) : null;
}

const conversationPath = (id: string, cwd: string | null, rest: string, query: Record<string, string> = {}): string => {
  const params = new URLSearchParams({ ...query, ...(cwd === null ? {} : { cwd }) });
  return `/api/library/conversations/${encodeURIComponent(id)}/${rest}?${params.toString()}`;
};

/** The files a conversation changed with Claude Code's edit tools, and the versions kept of each. */
export async function loadLibraryFiles(id: string, cwd: string | null): Promise<LibraryTrackedFile[] | null> {
  const body = await readJson(conversationPath(id, cwd, "files"));
  return body !== null && isUnknownArray(body.files) ? body.files.filter(isLibraryTrackedFile) : null;
}

/** One version of one of those files: a kept number, or the file as it is now. */
export async function loadLibraryFileText(id: string, cwd: string | null, trackingPath: string, version: number | "now"): Promise<LibraryFileText | null> {
  const body = await readJson(conversationPath(id, cwd, "file", { file: trackingPath, version: String(version) }));
  return isLibraryFileText(body) ? body : null;
}

/** The conversation that made each of these PRs in `repository`, for those the Library knows. */
export async function loadPrCreators(repository: string, numbers: readonly number[]): Promise<LibraryPrCreator[] | null> {
  const asked = numbers.slice(0, PR_CREATORS_MAX).join(",");
  const body = await readJson(`/api/library/pr-creators?repo=${encodeURIComponent(repository)}&numbers=${asked}`);
  return body !== null && isUnknownArray(body.creators) ? body.creators.filter(isLibraryPrCreator) : null;
}

/** One conversation by id; `cwd` picks among copies of one session in several projects. */
export async function loadLibraryConversation(id: string, cwd: string | null = null): Promise<LibraryConversation | null> {
  const query = cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`;
  const body = await readJson(`/api/library/conversations/${encodeURIComponent(id)}${query}`);
  return isLibraryConversation(body) ? body : null;
}

export async function loadLibraryMarks(): Promise<LibraryMarks | null> {
  const body = await readJson("/api/library/marks");
  return isLibraryMarks(body) ? body : null;
}

/** The marks after the change, or null when it was not saved. */
export async function saveLibraryMark(id: string, change: LibraryMarkChange): Promise<LibraryMarks | null> {
  try {
    const response = await fetchWithTimeout(`/api/library/marks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    });
    const body = response.ok ? await jsonBody(response) : null;
    return isLibraryMarks(body) ? body : null;
  } catch {
    return null;
  }
}
