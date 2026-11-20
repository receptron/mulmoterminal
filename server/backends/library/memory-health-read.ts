// Reading what the memory health rules judge (#3331): every memory folder's texts, and which paths
// the memories name are not on disk. The judging itself is memory-health.ts.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEMORY_INDEX_FILE, projectSlug, type LibraryMemoryHealth } from "../../../common/libraryMemory.js";
import { readBoundedText } from "./file-history-read.js";
import { inBatches, indexOf, MEMORY_FILES_AT_ONCE, memoryFileNames, memorySlugs } from "./memory-folders.js";
import { memoryHealth, pathReferences, resolveReference, topFolder, type MemoryHealthInput } from "./memory-health.js";
import { repoKey, withWorkCopies, workCopyIssues } from "./memory-workcopies.js";
import { memoryVersion } from "./memory-write.js";
import { resolveRemoteForge } from "../../git/gitRemote.js";
import { createTtlCache } from "../../git/ttl-cache.js";

/** Projects judged at once; files within one are read MEMORY_FILES_AT_ONCE at a time. */
const PROJECTS_AT_ONCE = 8;

const exists = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

/** The most of one memory the checks read: real memories are a few kilobytes; a larger one is judged
 *  on its listing alone (its links and paths are not looked for). */
export const MEMORY_CHECK_MAX_BYTES = 256 * 1024;
/** How much text the cache keeps in all; the oldest goes first past it. */
export const CACHED_TEXT_BYTES = 16 * 1024 * 1024;

/** Texts by file and stamp, so opening the Library again reads only what changed since. */
const texts = new Map<string, string | null>();
let cachedBytes = 0;

function remember(key: string, text: string | null): void {
  texts.set(key, text);
  cachedBytes += text?.length ?? 0;
  while (cachedBytes > CACHED_TEXT_BYTES && texts.size > 0) {
    const [oldest, kept] = texts.entries().next().value ?? ["", null];
    texts.delete(oldest);
    cachedBytes -= kept?.length ?? 0;
  }
}

async function memoryText(file: string): Promise<string | null> {
  const info = await fs.lstat(file).catch(() => null);
  if (info === null || !info.isFile() || info.size > MEMORY_CHECK_MAX_BYTES) return null;
  const key = `${file}\u0000${String(info.size)}\u0000${String(info.mtimeMs)}`;
  const known = texts.get(key);
  if (known !== undefined) return known;
  const text = (await readBoundedText(file)).text;
  remember(key, text);
  return text;
}

async function inputOf(projectsRoot: string, slug: string): Promise<MemoryHealthInput> {
  const folder = path.join(projectsRoot, slug, "memory");
  const names = await memoryFileNames(folder);
  const files = await inBatches(names, MEMORY_FILES_AT_ONCE, async (file) => ({ file, text: await memoryText(path.join(folder, file)) }));
  // An index that is there but cannot be read is not "no index": it is judged as unknown.
  const there = await fs.lstat(path.join(folder, MEMORY_INDEX_FILE)).then(
    () => true,
    () => false,
  );
  const counts = (await indexOf(folder)) ?? { lines: 0, bytes: 0 };
  const index = there ? { ...counts, text: (await readBoundedText(path.join(folder, MEMORY_INDEX_FILE))).text } : null;
  return { slug, index, files };
}

/** Whether an absolute path could be one on this machine: its top folder is here. `/sche_b1.cgi` or
 *  `/be9/x.cgi` in a memory are a site's paths, not this disk's. */
async function isLocalPath(resolved: string): Promise<boolean> {
  const top = topFolder(resolved, path);
  return top !== null && (await exists(top));
}

/** The paths the memories name that are not on disk. Only existence is asked — nothing is read. */
async function missingReferences(input: MemoryHealthInput, cwd: string | null): Promise<Set<string>> {
  const references = [...new Set(input.files.flatMap((file) => (file.text === null ? [] : pathReferences(file.text))))];
  // A path under the project is judged only when the project is here; one elsewhere only when its top
  // folder is (a site's `/x.cgi` is not this disk's).
  const projectHere = cwd !== null && (await exists(cwd));
  const checked = await inBatches(references, MEMORY_FILES_AT_ONCE, async (reference) => {
    const resolved = resolveReference(reference, cwd, os.homedir(), process.platform === "win32");
    if (resolved === null) return null;
    const underProject = cwd !== null && !path.isAbsolute(reference) && !reference.startsWith("~");
    if (underProject ? !projectHere : !(await isLocalPath(resolved))) return null;
    return (await exists(resolved)) ? null : reference;
  });
  return new Set(checked.filter((reference): reference is string => reference !== null));
}

/** The directory each folder belongs to, when only one directory has that folder's name: two that
 *  differ only in a character the name drops (`a.b`, `a-b`) leave it unknown, and its relative paths
 *  are not judged rather than judged against the wrong checkout. */
export function directoriesBySlug(cwds: readonly string[]): Map<string, string> {
  const found = new Map<string, Set<string>>();
  cwds.forEach((cwd) => found.set(projectSlug(cwd), (found.get(projectSlug(cwd)) ?? new Set()).add(cwd)));
  return new Map([...found].flatMap(([slug, dirs]) => (dirs.size === 1 ? [[slug, [...dirs][0] ?? ""] as const] : [])));
}

/** The repository a directory is a copy of: where its `origin` points, whatever the forge. */
export type RepoOf = (dir: string) => Promise<string | null>;

/** A clone's remote effectively never changes, and every opening of the Library asks for each folder. */
const REPO_CACHE_MS = 60_000;
const repos = createTtlCache<string | null>();

const originOf: RepoOf = async (dir) => {
  const known = repos.get(dir, Date.now, REPO_CACHE_MS);
  if (known !== undefined) return known;
  const forge = await resolveRemoteForge(dir).catch(() => null);
  const repo = forge === null ? null : repoKey(forge);
  repos.set(dir, repo, Date.now);
  return repo;
};

/** Every project with something to tidy, judged by rule. `cwds` name the projects' directories, which
 *  relative paths in their memory are taken against, and whose repository says which are work copies
 *  of one another. */
export async function readMemoryHealth(
  projectsRoot: string,
  cwds: readonly string[],
  now_ms: number = Date.now(),
  repoOf: RepoOf = originOf,
): Promise<LibraryMemoryHealth[]> {
  const bySlug = directoriesBySlug(cwds);
  const slugs = await memorySlugs(projectsRoot, now_ms);
  const judged = await inBatches(slugs, PROJECTS_AT_ONCE, async (slug) => {
    const cwd = bySlug.get(slug) ?? null;
    const input = await inputOf(projectsRoot, slug);
    const [missing, repo] = await Promise.all([missingReferences(input, cwd), cwd === null ? null : repoOf(cwd)]);
    // Only a version of each text is kept past here: every folder is held until all are read.
    const files = input.files.map(({ file, text }) => ({ file, version: text === null ? null : memoryVersion(text) }));
    return { slug, repo, files, health: memoryHealth(input, missing) };
  });
  const copies = workCopyIssues(judged);
  return judged
    .map(({ health }) => withWorkCopies(health, copies.get(health.slug)))
    .filter((health) => health.issues.length > 0 || Object.keys(health.files).length > 0);
}
