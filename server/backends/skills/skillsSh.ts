// skills.sh, read for the Skills viewer (#2835): the search the official `npx skills find` uses, and
// the snapshot `npx skills add` downloads — the same two endpoints, unauthenticated, on the one host.
// Neither is a documented API, so every answer is parsed against a schema and anything else is "could
// not read it" rather than a guess. Nothing here writes to disk.
import { z } from "zod";
import { isRemoteSkillId, isRemoteSource, type RemoteSkill, type RemoteSkillDoc } from "../../../common/skillsSh.js";
import { readChunks } from "../../infra/http/readChunks.js";

const SKILLS_SH_ORIGIN = "https://skills.sh";
const REQUEST_TIMEOUT_MS = 10_000;
const SEARCH_LIMIT = 50;
/** A query is a few words; anything longer is not sent anywhere. */
export const MAX_QUERY_CHARS = 200;
/** A whole snapshot, scripts and references included. Past this it is not read. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** The same bound the local viewer puts on a SKILL.md. */
const MAX_SKILL_DOC_CHARS = 1024 * 1024;
const MAX_NAME_CHARS = 200;
/** A skill is a page and a few helpers; a snapshot past this is not one, and is not listed row by row. */
const MAX_SNAPSHOT_FILES = 500;
const SKILL_FILE = "SKILL.md";

export type FetchText = (url: string, signal: AbortSignal) => Promise<string | null>;

/** The body of a 2xx answer, read no further than `maxBytes`; null for any other status, or for a
 *  body that is larger — refused from its declared length when it has one, and otherwise by stopping
 *  the read the moment the count is passed, so an oversized answer is never held whole. */
export async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.ok || Number(res.headers.get("content-length") ?? 0) > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return "";
  const chunks = await readChunks(res.body.getReader(), maxBytes);
  return chunks === null ? null : new TextDecoder().decode(Buffer.concat(chunks));
}

export const fetchText: FetchText = async (url, signal) =>
  readCapped(await fetch(url, { signal, headers: { accept: "application/json" } }), MAX_RESPONSE_BYTES);

const searchSchema = z.object({
  skills: z.array(z.object({ source: z.string(), skillId: z.string(), name: z.string(), installs: z.number().nonnegative() })),
});

const downloadSchema = z.object({ files: z.array(z.object({ path: z.string(), contents: z.string() })) });

// Strangers write these names; they are shown as text, but control characters still have no business
// in a list row.
const CONTROL_CHARS_RE = /\p{Cc}/gu;
const cleanName = (value: string): string => value.replace(CONTROL_CHARS_RE, "").slice(0, MAX_NAME_CHARS);

async function getJson(path: string, fetchImpl: FetchText): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const text = await fetchImpl(`${SKILLS_SH_ORIGIN}${path}`, abort.signal);
    if (text === null || text.length > MAX_RESPONSE_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The hits for `query` in skills.sh's own order — by relevance, which a re-sort by installs would
 *  bury under popular skills that barely match; null when skills.sh could not be read. A hit whose
 *  repository or skill name could not be put safely into a URL is dropped. */
export async function searchSkillsSh(query: string, fetchImpl: FetchText = fetchText): Promise<RemoteSkill[] | null> {
  const params = new URLSearchParams({ q: query.slice(0, MAX_QUERY_CHARS), limit: String(SEARCH_LIMIT) });
  const parsed = searchSchema.safeParse(await getJson(`/api/search?${params.toString()}`, fetchImpl));
  if (!parsed.success) return null;
  return parsed.data.skills
    .filter((hit) => isRemoteSource(hit.source) && isRemoteSkillId(hit.skillId))
    .slice(0, SEARCH_LIMIT)
    .map((hit) => ({ source: hit.source, skillId: hit.skillId, name: cleanName(hit.name), installs: hit.installs }));
}

/** The skill's SKILL.md and the list of files it would bring; null when the names are not safe to
 *  ask for, skills.sh has no such skill, or the snapshot has no SKILL.md small enough to show. */
export async function readSkillsShSkill(source: string, skillId: string, fetchImpl: FetchText = fetchText): Promise<RemoteSkillDoc | null> {
  if (!isRemoteSource(source) || !isRemoteSkillId(skillId)) return null;
  const [owner = "", repo = ""] = source.split("/");
  const path = `/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(skillId)}`;
  const parsed = downloadSchema.safeParse(await getJson(path, fetchImpl));
  if (!parsed.success || parsed.data.files.length > MAX_SNAPSHOT_FILES) return null;
  const skillFile = parsed.data.files.find((file) => file.path === SKILL_FILE);
  if (!skillFile || skillFile.contents.length > MAX_SKILL_DOC_CHARS) return null;
  const files = parsed.data.files
    .map((file) => ({ path: cleanName(file.path), bytes: Buffer.byteLength(file.contents, "utf8") }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { markdown: skillFile.contents, files };
}
