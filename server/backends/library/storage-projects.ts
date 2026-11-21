// The project folders of a measurement, matched to the directories they are named after (#3333).
// Pure: the folder-name rule and the temp roots are handed in.
//
// A folder is named from its directory by Claude Code's rule, so the Library's index — which holds
// every conversation's directory — answers which directory each folder is. A folder no conversation
// in the index names keeps a null directory; whether it came from a temp path is then read off its
// name, which starts with a temp root's folder name.
import type { StorageProject, StorageProjectRest, StorageSize } from "../../../common/libraryStorage.js";
import { addSizes } from "./storage-walk.js";
import type { ProjectSize } from "./storage-home.js";
import { isTemporaryCwd } from "./temporary-path.js";

/** How many projects one answer lists; the rest are summed. */
export const STORAGE_PROJECTS_LISTED = 300;

export interface StorageProjectRules {
  slugOf(cwd: string): string;
  temporaryRoots: readonly string[];
}

export interface StorageProjectList {
  projects: StorageProject[];
  rest: StorageProjectRest;
}

const NOTHING: StorageSize = { bytes: 0, files: 0, unreadable: 0 };

function temporarySlug(slug: string, rules: StorageProjectRules): boolean {
  return rules.temporaryRoots.some((root) => {
    const rootSlug = rules.slugOf(root);
    return slug === rootSlug || slug.startsWith(`${rootSlug}-`);
  });
}

/** Every folder with its directory, in the order given. */
export function matchProjects(projects: readonly ProjectSize[], cwds: readonly string[], rules: StorageProjectRules): StorageProject[] {
  const cwdBySlug = new Map<string, string>();
  cwds.forEach((cwd) => {
    const slug = rules.slugOf(cwd);
    if (!cwdBySlug.has(slug)) cwdBySlug.set(slug, cwd);
  });
  return projects.map((project) => {
    const cwd = cwdBySlug.get(project.slug) ?? null;
    const temporary = cwd === null ? temporarySlug(project.slug, rules) : isTemporaryCwd(cwd, rules.temporaryRoots);
    return { ...project, cwd, temporary };
  });
}

/** The projects a query matches (by directory or folder name, ignoring case), the first ones listed
 *  and the rest summed. */
export function listProjects(projects: readonly StorageProject[], query: string, limit: number = STORAGE_PROJECTS_LISTED): StorageProjectList {
  const needle = query.trim().toLowerCase();
  const matching = needle === "" ? projects : projects.filter((p) => (p.cwd ?? p.slug).toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle));
  const rest = matching.slice(limit);
  return { projects: matching.slice(0, limit), rest: { ...rest.reduce<StorageSize>(addSizes, NOTHING), count: rest.length } };
}
