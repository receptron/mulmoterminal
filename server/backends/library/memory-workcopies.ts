// Memory split across the work copies of one repository (#3331): Claude Code keeps memory per
// directory, so `app2`, `app3` and `app4` cloned from one remote each grow their own. A memory of the
// same file name in another copy is the same memory, kept apart. Pure: the reader hands in each
// folder's repository and each memory's version.
import type { LibraryMemoryHealth, MemoryFileIssue } from "../../../common/libraryMemory.js";

export interface WorkCopyMemory {
  slug: string;
  /** The repository the folder's directory is a copy of, or null when that is not known. */
  repo: string | null;
  /** Each memory's version (its text's hash), null when the text could not be read. */
  files: { file: string; version: string | null }[];
}

/** Which repository a remote names, the same however it was cloned: forges take a path in any case. */
export const repoKey = (forge: { host: string; path: string }): string => `${forge.host}/${forge.path}`.toLowerCase();

type InWorkCopies = Extract<MemoryFileIssue, { kind: "in-work-copies" }>;

/** By slug, then file: the other copies of the same repository holding a memory of that name, and
 *  whether each holds the same text. A text that could not be read is never the same. */
export function workCopyIssues(projects: readonly WorkCopyMemory[]): Map<string, Map<string, InWorkCopies>> {
  const byRepo = new Map<string, WorkCopyMemory[]>();
  projects.forEach((project) => project.repo !== null && byRepo.set(project.repo, [...(byRepo.get(project.repo) ?? []), project]));
  const issues = new Map<string, Map<string, InWorkCopies>>();
  [...byRepo.values()].forEach((copies) =>
    copies.forEach((project) => {
      const found = new Map(project.files.flatMap((file) => issueFor(file, project, copies)));
      if (found.size > 0) issues.set(project.slug, found);
    }),
  );
  return issues;
}

function issueFor(file: WorkCopyMemory["files"][number], project: WorkCopyMemory, copies: readonly WorkCopyMemory[]): [string, InWorkCopies][] {
  const others = copies.flatMap((copy) => {
    const twin = copy.slug === project.slug ? undefined : copy.files.find((candidate) => candidate.file === file.file);
    return twin === undefined ? [] : [{ slug: copy.slug, same: file.version !== null && twin.version === file.version }];
  });
  return others.length === 0 ? [] : [[file.file, { kind: "in-work-copies", copies: others }]];
}

/** A project's health with each file's work-copy issue added, so a file with nothing else to tidy is
 *  listed for this one. */
export function withWorkCopies(health: LibraryMemoryHealth, found: ReadonlyMap<string, InWorkCopies> | undefined): LibraryMemoryHealth {
  if (found === undefined) return health;
  const files = { ...health.files };
  found.forEach((issue, file) => (files[file] = [...(files[file] ?? []), issue]));
  return { ...health, files };
}
