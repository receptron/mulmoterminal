// The checkout a reviewer works in (#3425): the PR's head, detached, in a worktree of the
// repository's own clone that nobody else uses — never the author's checkout. It sits outside the
// managed worktrees root on purpose: it is no task, so it gets no worktree env and no board row.
import path from "node:path";

export type GitRun = (args: string[], cwd: string) => Promise<{ ok: boolean; stdout: string }>;

export interface ReviewWorktreeDeps {
  git: GitRun;
  exists: (dir: string) => boolean;
}

const SLUG_UNSAFE = /[^A-Za-z0-9._-]/g;

/** Where `repo`'s PR `pr` is reviewed, under `root`. One per PR: a later round moves it. */
export function reviewWorktreeDir(root: string, repo: string, pr: number): string {
  return path.join(root, `${repo.replace("/", "-").replace(SLUG_UNSAFE, "_")}-pr${pr}`);
}

/** Fetches the PR's head into the clone, then puts the worktree on it — made when absent, moved
 *  when present. The reviewer's own edits there are thrown away: it is told never to keep any. */
export async function checkoutReviewHead(deps: ReviewWorktreeDeps, clone: string, dir: string, pr: number, head: string): Promise<string | null> {
  const fetched = await deps.git(["fetch", "--quiet", "origin", `pull/${pr}/head`], clone);
  if (!fetched.ok) return `could not fetch pull/${pr}/head into ${clone}`;
  const placed = deps.exists(dir)
    ? await deps.git(["checkout", "--quiet", "--force", "--detach", head], dir)
    : await deps.git(["worktree", "add", "--quiet", "--detach", dir, head], clone);
  return placed.ok ? null : `could not check out ${head} in ${dir}`;
}

/** Removes the worktree and its registration; a directory already gone is not an error. */
export async function removeReviewWorktree(deps: ReviewWorktreeDeps, clone: string, dir: string): Promise<string | null> {
  if (!deps.exists(dir)) return null;
  const removed = await deps.git(["worktree", "remove", "--force", dir], clone);
  return removed.ok ? null : `could not remove the review worktree ${dir}`;
}
