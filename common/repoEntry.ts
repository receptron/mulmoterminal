// Reading a configured repository entry — `owner/repo`, or `host/owner/repo` for one that is not
// on GitHub (#981).
//
// In `common/` because BOTH sides decide from it: the server turns an entry into a forge to know
// which CLI to run, and the browser needs the same answer to say why a control is off. Written
// twice it would drift, and the two answers disagreeing is precisely the failure this abstraction
// is undoing.

export const GITHUB_HOST = "github.com";
export const GITLAB_HOST = "gitlab.com";

// A leading segment containing a DOT is the host. GitHub user and organisation names may hold only
// alphanumerics and hyphens, so `owner/repo` and `host/owner/repo` cannot be confused.
const HOST_SEGMENT = /\./;

export interface RepoEntry {
  host: string;
  /** The segments after the host — how many of them name a project is the HOST's rule, not this. */
  path: string[];
  /** True when the entry spelled the host out. `owner/repo` implies github.com without saying it. */
  declared: boolean;
}

/** Split an entry into host and path, or null when it is not one.
 *
 *  Null for an empty segment — a doubled, leading or trailing slash. Forgiving those would let
 *  `owner//repo` parse as `owner/repo` while the entry is STORED verbatim and handed to a CLI with
 *  the extra slash still in it, which is a parse error there.
 */
export function parseRepoEntry(entry: string): RepoEntry | null {
  const segments = entry.trim().split("/");
  if (segments.some((segment) => segment === "")) return null;
  const first = segments[0];
  const host = segments.length > 1 && first !== undefined && HOST_SEGMENT.test(first) ? first : null;
  return host === null ? { host: GITHUB_HOST, path: segments, declared: false } : { host: host.toLowerCase(), path: segments.slice(1), declared: true };
}

/** The identity a repository is known by ON ITS OWN HOST — `owner/repo` for GitHub, the group path
 *  for GitLab — with any declared host stripped.
 *
 *  `/api/repo-dirs` keys by this, because it derives the name from a clone's remote URL where the
 *  host is not part of the path. A configured entry may spell the host out (`github.com/owner/repo`
 *  became storable in #981 step 2a), so comparing the raw entry against those keys finds nothing
 *  and reports "no local clone" for a repo that has one (Codex review).
 */
export const canonicalRepo = (entry: string): string => parseRepoEntry(entry)?.path.join("/") ?? entry.trim();

/** `owner/repo` for an entry on GitHub, spelled with its host or without; null for any other forge
 *  or shape. What a GitHub record (a transcript's PR link) names the repository by. */
export function githubRepoName(entry: string): string | null {
  const parsed = parseRepoEntry(entry);
  return parsed !== null && parsed.host === GITHUB_HOST && parsed.path.length === NAMESPACED ? parsed.path.join("/") : null;
}

/** The identity used to MATCH a configured entry against a resolved clone: always host-qualified.
 *
 *  Distinct from `canonicalRepo`, which strips the host because that is what a CLI's `--repo`
 *  wants. Matching needs the opposite: without the host, `github.com/a/b` and `gitlab.com/a/b`
 *  collapse to the same key, and a clone of one would answer for the other (#981).
 */
export const repoIdentity = (entry: string): string => {
  const parsed = parseRepoEntry(entry);
  return parsed ? `${parsed.host}/${parsed.path.join("/")}`.toLowerCase() : entry.trim().toLowerCase();
};

// The value reaches a CLI's `--repo`, so no spaces and nothing readable as a flag.
const REPO_CHARS_RE = /^[A-Za-z0-9._/-]+$/;
// Every forge names a project as namespace + name, so one segment is never a repository.
const NAMESPACED = 2;

/** Whether a string may be stored and used as a repository entry.
 *
 *  The ONE rule. It was written out four times — the config sanitizer, both issue-start endpoints
 *  and the Settings field — and widening only the first meant an entry the user could save was
 *  rejected by everything downstream, including the form that was supposed to accept it (#981).
 *
 *  A hostless entry must be exactly `owner/repo`: `gh --repo` reads `a/b/c` as host `a`, so
 *  accepting it would have this side and the CLI aiming at different servers. A declared host may
 *  be followed by a nested GitLab group.
 */
export function isRepoEntry(entry: string): boolean {
  const parsed = REPO_CHARS_RE.test(entry.trim()) ? parseRepoEntry(entry) : null;
  if (!parsed) return false;
  return parsed.declared ? parsed.path.length >= NAMESPACED : parsed.path.length === NAMESPACED;
}
