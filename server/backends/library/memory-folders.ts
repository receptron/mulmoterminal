// Reading Claude Code's memory folders for the Library (#3331): `<projects>/<slug>/memory/`, each
// with its `MEMORY.md` index and its memory files. Read only.
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import {
  frontmatterStillOpen,
  MEMORY_INDEX_FILE,
  memoryType,
  parseMemoryFrontmatter,
  type LibraryMemoryFile,
  type LibraryMemoryProject,
  isProjectSlug,
} from "../../../common/libraryMemory.js";
import { directoriesByFolder } from "./project-folders.js";
import { isSameIdentity } from "../../files/fileIdentity.js";

/** Folders read at once: a machine has thousands of project folders, most with no memory at all. */
const FOLDERS_AT_ONCE = 64;

/** A memory file's name as the folder holds it: a plain `.md` name, never a path. */
export const isMemoryFileName = (name: string): boolean => /^\w[\w.-]{0,199}\.md$/.test(name);

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Whether the folder holds an entry by exactly this name: a case-insensitive disk opens `A.md` as
 *  `a.md`, and the index links to the name as it is spelt on disk. */
export const isSpeltAsOnDisk = async (folder: string, name: string): Promise<boolean> => (await entriesOf(folder)).some((entry) => entry.name === name);

/** Whether a file IS the index Claude Code opens as `MEMORY.md`: the same file on disk, so `memory.md`
 *  is the index on a case-insensitive disk (macOS, Windows) and a memory of its own beside it on a
 *  case-sensitive one (Linux). */
export async function isTheIndex(folder: string, name: string): Promise<boolean> {
  if (name.toLowerCase() !== MEMORY_INDEX_FILE.toLowerCase()) return false;
  const statOf = (file: string) => fs.lstat(path.join(folder, file), { bigint: true }).catch(() => null);
  const [file, index] = await Promise.all([statOf(name), statOf(MEMORY_INDEX_FILE)]);
  return file !== null && index !== null && isSameIdentity(file, index);
}

/** What the list reads of each memory: its frontmatter, which opens the file — read in steps until its
 *  closing line, up to a bound. The whole of a memory is read only when one is opened, so a folder of
 *  large memories costs this much each. A frontmatter past the bound lists the memory by its file name. */
export const MEMORY_HEAD_STEP_BYTES = 8 * 1024;
export const MEMORY_HEAD_MAX_BYTES = 64 * 1024;

/** A regular file opened for reading, or null: not a link, and the handle is the very file that was
 *  checked — a link swapped in between the check and the open is refused. Every read in this file
 *  goes through here. */
export async function openRegularFile(file: string): Promise<{ handle: fs.FileHandle; mtimeMs: number } | null> {
  const seen = await fs.lstat(file, { bigint: true }).catch(() => null);
  if (seen === null || !seen.isFile()) return null;
  const handle = await fs.open(file, "r").catch(() => null);
  if (handle === null) return null;
  const opened = await handle.stat({ bigint: true }).catch(() => null);
  // The time as a number from the handle: the bigint stats carry it only in whole milliseconds.
  const timed = opened !== null && isSameIdentity(seen, opened) ? await handle.stat().catch(() => null) : null;
  if (timed !== null) return { handle, mtimeMs: timed.mtimeMs };
  await handle.close();
  return null;
}

async function headOf(handle: fs.FileHandle): Promise<string> {
  const chunks: Buffer[] = [];
  let read = 0;
  try {
    while (read < MEMORY_HEAD_MAX_BYTES) {
      const buffer = Buffer.alloc(MEMORY_HEAD_STEP_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, read);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      read += bytesRead;
      if (!frontmatterStillOpen(Buffer.concat(chunks).toString("utf8"))) break;
    }
  } catch {
    // What was read before a failure is still the head there is.
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A memory file as the list shows it. Only a regular file is one — a link is left out — and one that
 *  cannot be read (too large, not text) is still listed by its file name, for the reader to say so. */
async function memoryFileOf(folder: string, file: string): Promise<LibraryMemoryFile | null> {
  const opened = await openRegularFile(path.join(folder, file));
  if (opened === null) return null;
  try {
    const { fields, metadata } = parseMemoryFrontmatter(await headOf(opened.handle));
    return {
      file,
      name: fields.name ?? null,
      description: fields.description ?? null,
      type: memoryType({ fields, metadata }),
      updatedAt: opened.mtimeMs,
    };
  } finally {
    await opened.handle.close();
  }
}

const NEWLINE = 0x0a;

/** Lines and bytes of the index, streamed: only the counts are wanted, and an index far past what
 *  Claude Code loads is exactly the one the gauge must show, not leave out. A last line without a
 *  newline counts. Not through a link, like every read here. */
export async function indexOf(folder: string): Promise<LibraryMemoryProject["index"]> {
  const opened = await openRegularFile(path.join(folder, MEMORY_INDEX_FILE));
  if (opened === null) return null;
  let newlines = 0;
  let bytes = 0;
  let last = NEWLINE;
  try {
    for await (const chunk of opened.handle.createReadStream({ autoClose: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      for (const byte of buffer) if (byte === NEWLINE) newlines += 1;
      bytes += buffer.length;
      last = buffer.at(-1) ?? last;
    }
  } catch {
    return null;
  } finally {
    await opened.handle.close();
  }
  return { lines: newlines + (last === NEWLINE ? 0 : 1), bytes };
}

/** Files read at once within one folder: a folder can hold thousands of memories. */
export const MEMORY_FILES_AT_ONCE = 16;

/** `work` over `items`, at most `size` at a time, the results in order. */
export async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) results.push(...(await Promise.all(items.slice(start, start + size).map(work))));
  return results;
}

/** The memory files in a folder by name: regular files of the memory shape, the index left out. */
export async function memoryFileNames(folder: string): Promise<string[]> {
  const candidates = (await entriesOf(folder)).filter((entry) => entry.isFile() && isMemoryFileName(entry.name)).map((entry) => entry.name);
  const indexes = await inBatches(candidates, MEMORY_FILES_AT_ONCE, (name) => isTheIndex(folder, name));
  return candidates.filter((_, place) => !indexes[place]);
}

async function projectOf(projectsRoot: string, slug: string, cwds: ReadonlyMap<string, string>): Promise<LibraryMemoryProject | null> {
  const folder = path.join(projectsRoot, slug, "memory");
  const names = await memoryFileNames(folder);
  const index = await indexOf(folder);
  if (names.length === 0 && index === null) return null;
  const files = (await inBatches(names, MEMORY_FILES_AT_ONCE, (name) => memoryFileOf(folder, name))).filter((file): file is LibraryMemoryFile => file !== null);
  files.sort((a, b) => b.updatedAt - a.updatedAt);
  return { slug, cwd: cwds.get(slug) ?? null, index, files };
}

/** How long the list of folders holding memory is reused. Finding them means looking into every
 *  project folder — over ten thousand on a long-used machine — while the memory inside the few that
 *  have it is read fresh every time; a folder that gains memory shows up within this. */
export const MEMORY_FOLDERS_REUSE_MS = 30_000;

const folderLists = new Map<string, { at: number; slugs: Promise<string[]> }>();

// A linked project folder is followed, as the routes follow it and as Claude Code does: one that does
// not lead to a folder holding memory simply has none.
async function slugsWithMemory(projectsRoot: string): Promise<string[]> {
  const slugs = (await entriesOf(projectsRoot))
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && isProjectSlug(entry.name))
    .map((entry) => entry.name);
  const kept: string[] = [];
  for (let start = 0; start < slugs.length; start += FOLDERS_AT_ONCE) {
    const batch = slugs.slice(start, start + FOLDERS_AT_ONCE);
    const has = await Promise.all(batch.map(async (slug) => (await entriesOf(path.join(projectsRoot, slug, "memory"))).length > 0));
    kept.push(...batch.filter((_, index) => has[index]));
  }
  return kept;
}

/** The folders holding memory, looked for again once the last look is older than the reuse time. */
export function memorySlugs(projectsRoot: string, now_ms: number): Promise<string[]> {
  const known = folderLists.get(projectsRoot);
  if (known !== undefined && now_ms - known.at < MEMORY_FOLDERS_REUSE_MS) return known.slugs;
  const slugs = slugsWithMemory(projectsRoot);
  folderLists.set(projectsRoot, { at: now_ms, slugs });
  slugs.catch(() => folderLists.delete(projectsRoot));
  return slugs;
}

/** Every project folder that holds memory, the most recently written first, each named by the
 *  directory a conversation there ran in (`cwds`, from the index) when one is known. */
export async function listMemoryProjects(projectsRoot: string, cwds: readonly string[], now_ms: number = Date.now()): Promise<LibraryMemoryProject[]> {
  const bySlug = await directoriesByFolder(cwds);
  const slugs = await memorySlugs(projectsRoot, now_ms);
  const projects: LibraryMemoryProject[] = [];
  for (let start = 0; start < slugs.length; start += FOLDERS_AT_ONCE) {
    const batch = await Promise.all(slugs.slice(start, start + FOLDERS_AT_ONCE).map((slug) => projectOf(projectsRoot, slug, bySlug)));
    projects.push(...batch.filter((project): project is LibraryMemoryProject => project !== null));
  }
  const newest = (project: LibraryMemoryProject): number => project.files[0]?.updatedAt ?? 0;
  return projects.sort((a, b) => newest(b) - newest(a));
}
