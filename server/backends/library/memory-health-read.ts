// Reading what the memory health rules judge (#3331): every memory folder's texts, and which paths
// the memories name are not on disk. The judging itself is memory-health.ts.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEMORY_INDEX_FILE, projectSlug, type LibraryMemoryHealth } from "../../../common/libraryMemory.js";
import { readBoundedText } from "./file-history-read.js";
import { indexOf, memoryFileNames, memorySlugs } from "./memory-folders.js";
import { memoryHealth, pathReferences, resolveReference, type MemoryHealthInput } from "./memory-health.js";

/** Projects judged at once, and memory files read at once within one: a folder can hold thousands. */
const PROJECTS_AT_ONCE = 8;
const FILES_AT_ONCE = 16;

async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) results.push(...(await Promise.all(items.slice(start, start + size).map(work))));
  return results;
}

const exists = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

async function inputOf(projectsRoot: string, slug: string): Promise<MemoryHealthInput> {
  const folder = path.join(projectsRoot, slug, "memory");
  const names = await memoryFileNames(folder);
  const files = await inBatches(names, FILES_AT_ONCE, async (file) => ({ file, text: (await readBoundedText(path.join(folder, file))).text }));
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
  const top = resolved.split(path.sep).filter((part) => part !== "")[0];
  return top !== undefined && (await exists(path.join(path.parse(resolved).root, top)));
}

/** The paths the memories name that are not on disk. Only existence is asked — nothing is read. */
async function missingReferences(input: MemoryHealthInput, cwd: string | null): Promise<Set<string>> {
  const references = [...new Set(input.files.flatMap((file) => (file.text === null ? [] : pathReferences(file.text))))];
  const checked = await Promise.all(
    references.map(async (reference) => {
      const resolved = resolveReference(reference, cwd, os.homedir(), process.platform === "win32");
      if (resolved === null || !(await isLocalPath(resolved))) return null;
      return (await exists(resolved)) ? null : reference;
    }),
  );
  return new Set(checked.filter((reference): reference is string => reference !== null));
}

/** Every project with something to tidy, judged by rule. `cwds` name the projects' directories, which
 *  relative paths in their memory are taken against. */
export async function readMemoryHealth(projectsRoot: string, cwds: readonly string[], now_ms: number = Date.now()): Promise<LibraryMemoryHealth[]> {
  const bySlug = new Map(cwds.map((cwd) => [projectSlug(cwd), cwd] as const));
  const slugs = await memorySlugs(projectsRoot, now_ms);
  const results: LibraryMemoryHealth[] = [];
  for (let start = 0; start < slugs.length; start += PROJECTS_AT_ONCE) {
    const batch = await Promise.all(
      slugs.slice(start, start + PROJECTS_AT_ONCE).map(async (slug) => {
        const input = await inputOf(projectsRoot, slug);
        return memoryHealth(input, await missingReferences(input, bySlug.get(slug) ?? null));
      }),
    );
    results.push(...batch.filter((health) => health.issues.length > 0 || Object.keys(health.files).length > 0));
  }
  return results;
}
