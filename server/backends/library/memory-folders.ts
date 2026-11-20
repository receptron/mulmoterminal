// Reading Claude Code's memory folders for the Library (#3331): `<projects>/<slug>/memory/`, each
// with its `MEMORY.md` index and its memory files. Read only.
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { MEMORY_INDEX_FILE, parseMemoryFrontmatter, projectSlug, type LibraryMemoryFile, type LibraryMemoryProject } from "../../../common/libraryMemory.js";
import { readBoundedText } from "./file-history-read.js";

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

async function memoryFileOf(folder: string, file: string): Promise<LibraryMemoryFile | null> {
  const read = await readBoundedText(path.join(folder, file));
  if (read.text === null) return null;
  const { fields, metadata } = parseMemoryFrontmatter(read.text);
  const info = await fs.lstat(path.join(folder, file)).catch(() => null);
  return { file, name: fields.name ?? null, description: fields.description ?? null, type: metadata.type ?? null, updatedAt: info?.mtimeMs ?? 0 };
}

async function indexOf(folder: string): Promise<LibraryMemoryProject["index"]> {
  const read = await readBoundedText(path.join(folder, MEMORY_INDEX_FILE));
  if (read.text === null) return null;
  const lines = read.text === "" ? 0 : read.text.replace(/\n$/, "").split("\n").length;
  return { lines, bytes: Buffer.byteLength(read.text) };
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

/** Every project folder that holds memory, the most recently written first, each named by the
 *  directory a conversation there ran in (`cwds`, from the index) when one is known. */
export async function listMemoryProjects(projectsRoot: string, cwds: readonly string[]): Promise<LibraryMemoryProject[]> {
  const bySlug = new Map(cwds.map((cwd) => [projectSlug(cwd), cwd] as const));
  const slugs = (await entriesOf(projectsRoot)).filter((entry) => entry.isDirectory() && isProjectSlug(entry.name)).map((entry) => entry.name);
  const projects: LibraryMemoryProject[] = [];
  for (let start = 0; start < slugs.length; start += FOLDERS_AT_ONCE) {
    const batch = await Promise.all(slugs.slice(start, start + FOLDERS_AT_ONCE).map((slug) => projectOf(projectsRoot, slug, bySlug)));
    projects.push(...batch.filter((project): project is LibraryMemoryProject => project !== null));
  }
  const newest = (project: LibraryMemoryProject): number => project.files[0]?.updatedAt ?? 0;
  return projects.sort((a, b) => newest(b) - newest(a));
}
