// How the Library lists memory (#3331): which memories a search keeps, how full an index is, and
// where a `[[name]]` link goes. Pure.
import { MEMORY_INDEX_BYTES_MAX, MEMORY_INDEX_LINES_MAX, type LibraryMemoryFile, type LibraryMemoryProject } from "../../../common/libraryMemory";

/** Past this share of either limit the gauge warns: the next few lines may fall out of what loads. */
export const MEMORY_INDEX_WARN_RATIO = 0.9;

export interface IndexFill {
  lines: number;
  bytes: number;
  /** Which limit is the nearer, and so the one the gauge names. */
  by: "lines" | "bytes";
  /** The fuller of lines and bytes, as a share of what Claude Code loads. */
  ratio: number;
  warn: boolean;
}

export function indexFill(index: LibraryMemoryProject["index"]): IndexFill | null {
  if (index === null) return null;
  const byLines = index.lines / MEMORY_INDEX_LINES_MAX;
  const byBytes = index.bytes / MEMORY_INDEX_BYTES_MAX;
  const ratio = Math.max(byLines, byBytes);
  return { lines: index.lines, bytes: index.bytes, by: byBytes > byLines ? "bytes" : "lines", ratio, warn: ratio > MEMORY_INDEX_WARN_RATIO };
}

/** A memory's title: its frontmatter name, else its file name without `.md`. */
export const memoryTitle = (memory: LibraryMemoryFile): string => memory.name ?? memory.file.replace(/\.md$/, "");

/** The projects with only the memories a search matches (name, description, file), each project
 *  kept only while one of its memories is. An empty search keeps everything. */
export function filterMemory(projects: readonly LibraryMemoryProject[], query: string): LibraryMemoryProject[] {
  const words = query.trim().toLowerCase();
  if (words === "") return [...projects];
  const matches = (memory: LibraryMemoryFile): boolean =>
    [memory.name, memory.description, memory.file].some((field) => field !== null && field.toLowerCase().includes(words));
  return projects.map((project) => ({ ...project, files: project.files.filter(matches) })).filter((project) => project.files.length > 0);
}

/** The memory a `[[name]]` names in the same project — by frontmatter name, or by file name. */
export const linkTarget = (project: LibraryMemoryProject, name: string): LibraryMemoryFile | null =>
  project.files.find((memory) => memory.name === name || memory.file === `${name}.md`) ?? null;

/** A memory's place across projects, as one identity: the slug and the file. */
export const memoryKey = (slug: string, file: string): string => `${slug}/${file}`;
