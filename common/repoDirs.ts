// Which local clones a GitHub repository has on this machine — what `GET /api/repo-dirs` answers.
//
// Shared because both sides decide from it: the server resolves each saved directory's `origin`
// and groups them, and the UI picks which clone to start work in (and offers the rest). Several
// clones of one repo commonly run side by side here, so "the directory for owner/repo" is a
// CHOICE rather than a lookup — which is why a candidate carries what it takes to choose.

import { repoIdentity } from "./repoEntry.js";

export interface RepoDirCandidate {
  /** Absolute path of the clone (the canonical spelling `cwdPresets` stores). */
  path: string;
  /** The preset's label, which is what the user named this clone in Settings. */
  label: string;
  /** The directory's own `orderPriority` from `.mulmoterminal.json`, or null when it sets none. */
  orderPriority: number | null;
}

export interface RepoDirs {
  /** `owner/repo`. */
  repo: string;
  /** Candidates, already ordered: by `orderPriority`, then by path for the ones that set none. */
  dirs: RepoDirCandidate[];
  /** The recorded choice for this repo, or null when there is none to honour. Always one of
   *  `dirs` — a recording whose directory has since gone or now points at a different repo is
   *  dropped rather than returned, because the caller would otherwise start work in it. */
  primary: string | null;
}

export interface RepoDirsResponse {
  repos: RepoDirs[];
}

// The server is the only writer of this shape, but it arrives as a network response: an older
// build, a proxy returning HTML, or a half-deployed server would otherwise put `undefined` where
// a WORKING DIRECTORY is expected — and this value becomes the cwd a session is started in.
// Anything malformed is dropped rather than repaired, so a bad entry offers no clone at all
// instead of a wrong one.
const isCandidate = (v: unknown): v is RepoDirCandidate =>
  isObject(v) &&
  typeof v.path === "string" &&
  v.path !== "" &&
  typeof v.label === "string" &&
  (v.orderPriority === null || typeof v.orderPriority === "number");

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseRepoDirsResponse(data: unknown): RepoDirs[] {
  if (!isObject(data) || !Array.isArray(data.repos)) return [];
  return data.repos.filter(isObject).flatMap((entry) => {
    if (typeof entry.repo !== "string" || entry.repo === "" || !Array.isArray(entry.dirs)) return [];
    const dirs = entry.dirs.filter(isCandidate);
    // `primary` must name one of the candidates it came with. A recording the server kept but a
    // candidate list that no longer holds it would otherwise start work in a directory this side
    // never offered.
    const primary = typeof entry.primary === "string" && dirs.some((d) => d.path === entry.primary) ? entry.primary : null;
    return [{ repo: entry.repo, dirs, primary }];
  });
}

/** The clone work on `repo` starts in when nobody is asked: the recorded choice, else the first
 *  candidate (they arrive ordered). Null when this machine has no clone of it. */
export function defaultCloneOf(entries: readonly RepoDirs[], repo: string): string | null {
  const entry = entries.find((candidate) => repoIdentity(candidate.repo) === repoIdentity(repo));
  return entry ? (entry.primary ?? entry.dirs[0]?.path ?? null) : null;
}
