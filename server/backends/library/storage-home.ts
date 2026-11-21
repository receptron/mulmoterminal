// Claude Code's home measured entry by entry, and `projects/` project by project (#3333). Runs on the
// storage worker; the file system and the clock are passed in.
import { PROJECTS_ENTRY, type StorageEntry, type StorageProgress, type StorageSize } from "../../../common/libraryStorage.js";
import { addSizes, diskBytes, measurePath, type WalkFs } from "./storage-walk.js";

export interface ProjectSize extends StorageSize {
  slug: string;
}

/** What the worker hands back: the projects carry only their folder names, which the server matches
 *  to directories. */
export interface HomeMeasure {
  measuredAt: number;
  total: StorageSize;
  entries: StorageEntry[];
  projects: ProjectSize[];
}

const NOTHING: StorageSize = { bytes: 0, files: 0, unreadable: 0 };
const largestFirst = (a: StorageSize, b: StorageSize): number => b.bytes - a.bytes;

async function namesIn(dir: string, fs: WalkFs): Promise<string[] | null> {
  const stat = await fs.lstat(dir).catch(() => null);
  return stat?.isDirectory() === true ? fs.readdir(dir).catch(() => null) : null;
}

async function measureProjects(dir: string, names: readonly string[], fs: WalkFs, step: () => void): Promise<ProjectSize[]> {
  const projects: ProjectSize[] = [];
  for (const slug of names) {
    projects.push({ slug, ...(await measurePath(fs.join(dir, slug), fs)) });
    step();
  }
  return projects.sort(largestFirst);
}

/** The `projects` entry: its folder's own space plus every project in it. */
async function projectsEntry(dir: string, projects: readonly ProjectSize[], fs: WalkFs): Promise<StorageEntry> {
  const own = await fs.lstat(dir).catch(() => null);
  const ownSize = own === null ? { ...NOTHING, unreadable: 1 } : { ...NOTHING, bytes: diskBytes(own) };
  return { name: PROJECTS_ENTRY, directory: true, ...projects.reduce<StorageSize>(addSizes, ownSize) };
}

async function measureEntry(home: string, name: string, fs: WalkFs): Promise<StorageEntry> {
  const at = fs.join(home, name);
  const stat = await fs.lstat(at).catch(() => null);
  return { name, directory: stat?.isDirectory() === true, ...(await measurePath(at, fs)) };
}

const isMissing = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "ENOENT";

/** A home that cannot be listed measures as nothing: as unreadable unless it is plainly not there (a
 *  parent that may not be searched is a reason it cannot be read, not a missing home). */
async function unlistedHome(home: string, fs: WalkFs, now: () => number): Promise<HomeMeasure> {
  const missing = await fs.lstat(home).then(
    () => false,
    (err: unknown) => isMissing(err),
  );
  return { measuredAt: now(), total: { ...NOTHING, unreadable: missing ? 0 : 1 }, entries: [], projects: [] };
}

/** `home` measured. `onProgress` hears each step. */
export async function measureHome(home: string, fs: WalkFs, now: () => number, onProgress: (progress: StorageProgress) => void): Promise<HomeMeasure> {
  const names = await namesIn(home, fs);
  if (names === null) return unlistedHome(home, fs, now);
  const projectsDir = fs.join(home, PROJECTS_ENTRY);
  // Measured project by project only when it is a folder that can be listed; else it is one more entry.
  const slugs = names.includes(PROJECTS_ENTRY) ? await namesIn(projectsDir, fs) : null;
  const others = slugs === null ? names : names.filter((name) => name !== PROJECTS_ENTRY);
  const progress: StorageProgress = { done: 0, of: others.length + (slugs?.length ?? 0) };
  const step = (): void => onProgress({ done: ++progress.done, of: progress.of });
  const entries: StorageEntry[] = [];
  for (const name of others) {
    entries.push(await measureEntry(home, name, fs));
    step();
  }
  const projects = slugs === null ? [] : await measureProjects(projectsDir, slugs, fs, step);
  if (slugs !== null) entries.push(await projectsEntry(projectsDir, projects, fs));
  entries.sort(largestFirst);
  return { measuredAt: now(), total: entries.reduce<StorageSize>(addSizes, NOTHING), entries, projects };
}
