// The Library's reads (#3329): /api/library/* answered as checked values, or null for any failure —
// a 503 while the index cannot be opened, a timeout, or a body that is not the wire shape.
import { isUnknownArray } from "../../common/isUnknownArray";
import { isLibraryFileText, isLibraryTrackedFile, type LibraryFileText, type LibraryTrackedFile } from "../../common/libraryFiles";
import { isLibraryMemoryHealth, isLibraryMemoryProject, type LibraryMemoryHealth, type LibraryMemoryProject } from "../../common/libraryMemory";
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

/** Every project's memory folder: its index and its memories. */
export async function loadLibraryMemory(): Promise<LibraryMemoryProject[] | null> {
  const body = await readJson("/api/library/memory");
  return body !== null && isUnknownArray(body.projects) ? body.projects.filter(isLibraryMemoryProject) : null;
}

/** What can be tidied in every project's memory, by rule. */
export async function loadLibraryMemoryHealth(): Promise<LibraryMemoryHealth[] | null> {
  const body = await readJson("/api/library/memory-health");
  return body !== null && isUnknownArray(body.projects) ? body.projects.filter(isLibraryMemoryHealth) : null;
}

const memoryFileUrl = (slug: string, file: string): string => `/api/library/memory/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`;

/** One memory file's text (or the index's), with the version an edit must name. */
export async function loadLibraryMemoryFile(slug: string, file: string): Promise<(LibraryFileText & { version?: string }) | null> {
  const body = await readJson(memoryFileUrl(slug, file));
  if (!isLibraryFileText(body)) return null;
  return typeof body.version === "string" ? { ...body, version: body.version } : body;
}

/** The outcome of saving a memory: its new version, a change made on disk since it was opened, or a
 *  failure (a refusal, or no answer). */
export type MemorySaveResult = { kind: "saved"; version: string } | { kind: "changed" } | { kind: "failed" };

export async function saveLibraryMemoryFile(slug: string, file: string, text: string, version: string): Promise<MemorySaveResult> {
  try {
    const response = await fetchWithTimeout(
      memoryFileUrl(slug, file),
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, version }) },
      LIBRARY_READ_TIMEOUT_MS,
    );
    if (response.status === 409) return { kind: "changed" };
    const body = response.ok ? await jsonBody(response) : null;
    return body !== null && typeof body.version === "string" ? { kind: "saved", version: body.version } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export type MemoryTrashResult = { kind: "trashed"; undo: string } | { kind: "changed" } | { kind: "failed" };

/** Moves a memory to the Trash, with its lines in MEMORY.md, while it is still the text read. */
export async function trashLibraryMemoryFile(slug: string, file: string, version: string): Promise<MemoryTrashResult> {
  try {
    const response = await fetchWithTimeout(`${memoryFileUrl(slug, file)}/trash`, postJson({ version }), LIBRARY_READ_TIMEOUT_MS);
    if (response.status === 409) return { kind: "changed" };
    const body = response.ok ? await jsonBody(response) : null;
    return body !== null && typeof body.undo === "string" ? { kind: "trashed", undo: body.undo } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** "changed" names the memory that changed since it was opened: the one kept, or the one merged into it —
 *  or "links", one whose links the merge was rewriting, changed meanwhile (trying again is safe).
 *  "merged" carries the text as written — its own links to the merged memory point at it now — and how
 *  many links were; "unplaceable" names the memories whose links could not be rewritten exactly. */
export type MemoryMergeResult =
  | { kind: "merged"; version: string; undo: string; text: string; links: number }
  | { kind: "changed"; file: "into" | "from" | "links" }
  | { kind: "unplaceable"; files: string[] }
  | { kind: "failed" };

const stringsIn = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export interface MemoryMergeRequest {
  slug: string;
  into: string;
  text: string;
  version: string;
  from: string;
  fromVersion: string;
}

/** Writes `text` over `into` and moves `from` to the Trash with its lines in MEMORY.md, as one change. */
export async function mergeLibraryMemoryFiles({ slug, into, text, version, from, fromVersion }: MemoryMergeRequest): Promise<MemoryMergeResult> {
  try {
    const response = await fetchWithTimeout(`${memoryFileUrl(slug, into)}/merge`, postJson({ text, version, from, fromVersion }), LIBRARY_READ_TIMEOUT_MS);
    const body = await jsonBody(response);
    if (response.status === 409) return { kind: "changed", file: body.file === "from" || body.file === "links" ? body.file : "into" };
    if (response.status === 422) return { kind: "unplaceable", files: stringsIn(body.files) };
    const { version: written, undo, text: writtenText, links } = body;
    if (!response.ok || typeof written !== "string" || typeof undo !== "string" || typeof writtenText !== "string" || typeof links !== "number")
      return { kind: "failed" };
    return { kind: "merged", version: written, undo, text: writtenText, links };
  } catch {
    return { kind: "failed" };
  }
}

/** How many links merging `from` into `into` would point at `into`, or which memories' links could not be. */
export async function loadLibraryMemoryLinks(slug: string, into: string, from: string): Promise<{ count: number; unplaceable: string[] } | null> {
  const body = await readJson(`${memoryFileUrl(slug, into)}/links?from=${encodeURIComponent(from)}`);
  return body !== null && typeof body.count === "number" ? { count: body.count, unplaceable: stringsIn(body.unplaceable) } : null;
}

/** "taken": a file of that name was made since; "gone": too late to undo here (it is in the Trash). */
export type MemoryUndoResult = "restored" | "taken" | "gone" | "failed";

export async function undoLibraryMemoryTrash(undo: string): Promise<MemoryUndoResult> {
  try {
    const response = await fetchWithTimeout("/api/library/memory-undo", postJson({ undo }), LIBRARY_READ_TIMEOUT_MS);
    if (response.ok) return "restored";
    if (response.status === 409) return "taken";
    return response.status === 410 ? "gone" : "failed";
  } catch {
    return "failed";
  }
}

const postJson = (body: Record<string, unknown>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

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
