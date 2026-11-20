// Reading Claude Code's memory folders for the Library (#3331): `<projects>/<slug>/memory/`, each
// with its `MEMORY.md` index and its memory files. Read only.
import { createReadStream, promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { MEMORY_INDEX_FILE, parseMemoryFrontmatter, projectSlug, type LibraryMemoryFile, type LibraryMemoryProject } from "../../../common/libraryMemory.js";

/** Folders read at once: a machine has thousands of project folders, most with no memory at all. */
const FOLDERS_AT_ONCE = 64;

/** A memory file's name as the folder holds it: a plain `.md` name, never a path. */
export const isMemoryFileName = (name: string): boolean => /^\w[\w.-]{0,199}\.md$/.test(name) && !name.includes("..");
/** A project folder's name as Claude Code makes them (`projectSlug`). */
export const isProjectSlug = (slug: string): boolean => /^[A-Za-z0-9_-]{1,255}$/.test(slug);

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** What the list reads of each memory: its frontmatter, which opens the file. The whole of it is read
 *  only when one is opened, so a folder of large memories costs this much each. */
export const MEMORY_HEAD_BYTES = 8 * 1024;

async function headOf(file: string): Promise<string> {
  const handle = await fs.open(file, "r").catch(() => null);
  if (handle === null) return "";
  try {
    const buffer = Buffer.alloc(MEMORY_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await handle.close();
  }
}

/** A memory file as the list shows it. Only a regular file is one — a link is left out — and one that
 *  cannot be read (too large, not text) is still listed by its file name, for the reader to say so. */
async function memoryFileOf(folder: string, file: string): Promise<LibraryMemoryFile | null> {
  const info = await fs.lstat(path.join(folder, file)).catch(() => null);
  if (info === null || !info.isFile()) return null;
  const { fields, metadata } = parseMemoryFrontmatter(await headOf(path.join(folder, file)));
  return {
    file,
    name: fields.name ?? null,
    description: fields.description ?? null,
    type: metadata.type ?? fields.type ?? null,
    updatedAt: info.mtimeMs,
  };
}

const NEWLINE = 0x0a;

/** Lines and bytes of the index, streamed: only the counts are wanted, and an index far past what
 *  Claude Code loads is exactly the one the gauge must show, not leave out. A last line without a
 *  newline counts. Not through a link, like every read here. */
async function indexOf(folder: string): Promise<LibraryMemoryProject["index"]> {
  const file = path.join(folder, MEMORY_INDEX_FILE);
  const info = await fs.lstat(file).catch(() => null);
  if (info === null || !info.isFile()) return null;
  let newlines = 0;
  let bytes = 0;
  let last = NEWLINE;
  try {
    for await (const chunk of createReadStream(file)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      for (const byte of buffer) if (byte === NEWLINE) newlines += 1;
      bytes += buffer.length;
      last = buffer.at(-1) ?? last;
    }
  } catch {
    return null;
  }
  return { lines: newlines + (last === NEWLINE ? 0 : 1), bytes };
}

async function projectOf(projectsRoot: string, slug: string, cwds: ReadonlyMap<string, string>): Promise<LibraryMemoryProject | null> {
  const folder = path.join(projectsRoot, slug, "memory");
  const names = (await entriesOf(folder)).filter((entry) => entry.isFile() && entry.name !== MEMORY_INDEX_FILE && isMemoryFileName(entry.name));
  const index = await indexOf(folder);
  if (names.length === 0 && index === null) return null;
  const files = (await Promise.all(names.map((entry) => memoryFileOf(folder, entry.name)))).filter((file): file is LibraryMemoryFile => file !== null);
  files.sort((a, b) => b.updatedAt - a.updatedAt);
  return { slug, cwd: cwds.get(slug) ?? null, index, files };
}

/** How long the list of folders holding memory is reused. Finding them means looking into every
 *  project folder — over ten thousand on a long-used machine — while the memory inside the few that
 *  have it is read fresh every time; a folder that gains memory shows up within this. */
export const MEMORY_FOLDERS_REUSE_MS = 30_000;

const folderLists = new Map<string, { at: number; slugs: Promise<string[]> }>();

async function slugsWithMemory(projectsRoot: string): Promise<string[]> {
  const slugs = (await entriesOf(projectsRoot)).filter((entry) => entry.isDirectory() && isProjectSlug(entry.name)).map((entry) => entry.name);
  const kept: string[] = [];
  for (let start = 0; start < slugs.length; start += FOLDERS_AT_ONCE) {
    const batch = slugs.slice(start, start + FOLDERS_AT_ONCE);
    const has = await Promise.all(batch.map(async (slug) => (await entriesOf(path.join(projectsRoot, slug, "memory"))).length > 0));
    kept.push(...batch.filter((_, index) => has[index]));
  }
  return kept;
}

/** The folders holding memory, looked for again once the last look is older than the reuse time. */
function memorySlugs(projectsRoot: string, now_ms: number): Promise<string[]> {
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
  const bySlug = new Map(cwds.map((cwd) => [projectSlug(cwd), cwd] as const));
  const slugs = await memorySlugs(projectsRoot, now_ms);
  const projects: LibraryMemoryProject[] = [];
  for (let start = 0; start < slugs.length; start += FOLDERS_AT_ONCE) {
    const batch = await Promise.all(slugs.slice(start, start + FOLDERS_AT_ONCE).map((slug) => projectOf(projectsRoot, slug, bySlug)));
    projects.push(...batch.filter((project): project is LibraryMemoryProject => project !== null));
  }
  const newest = (project: LibraryMemoryProject): number => project.files[0]?.updatedAt ?? 0;
  return projects.sort((a, b) => newest(b) - newest(a));
}
