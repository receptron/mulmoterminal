// What a per-branch `gh` query opens with, in one place.
//
// Both branch-scoped queries — the open PR's URL and the branch's PR phase — take the same
// injectable dependencies, cache under the same key shape, and expire on the same 30s window.
// Each wrote that out itself, so a change to the caching (a different TTL, a different key)
// could land in one and not the other while both still compiled (#646 A3).
//
// The cache itself stays with each caller: they store different things in it.
import { runGh } from "./gh.js";

// A roster poll re-asks every few seconds; gh is a subprocess and a network call, so the
// answer is held briefly. Short enough that opening a PR shows up on the next poll or two.
export const BRANCH_QUERY_TTL_MS = 30_000;

export interface BranchQueryDeps {
  runGh?: typeof runGh;
  now?: () => number;
  ttlMs?: number;
}

/** The resolved dependencies and the cache key for one repo/branch lookup. */
export function branchQuery(deps: BranchQueryDeps, repo: string, branch: string) {
  return {
    run: deps.runGh ?? runGh,
    now: deps.now ?? Date.now,
    ttlMs: deps.ttlMs ?? BRANCH_QUERY_TTL_MS,
    key: `${repo}:${branch}`,
  };
}
