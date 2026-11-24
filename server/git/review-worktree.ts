// The checkout a reviewer works in (#3425): the PR's head, detached, in a worktree of the
// repository's own clone that nobody else uses — never the author's checkout. It sits outside the
// managed worktrees root on purpose: it is no task, so it gets no worktree env and no board row.
import path from "node:path";

export type GitRun = (args: string[], cwd: string) => Promise<{ ok: boolean; stdout: string }>;

export interface ReviewWorktreeDeps {
  git: GitRun;
  exists: (dir: string) => boolean;
  /** True for a symbolic link (not followed): one could point the forced checkout anywhere. */
  isSymlink: (dir: string) => boolean;
  realpath: (dir: string) => string;
}

const WORKTREE_LINE = "worktree ";

/** Whether `git worktree list --porcelain` names `dir` among the clone's worktrees, compared by real
 *  path since git prints resolved ones. */
export function listsWorktree(porcelain: string, dir: string, realpath: (p: string) => string): boolean {
  const wanted = realpath(dir);
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith(WORKTREE_LINE))
    .some((line) => {
      const listed = line.slice(WORKTREE_LINE.length);
      try {
        return realpath(listed) === wanted;
      } catch {
        return false;
      }
    });
}

/** An existing path is moved only when it is a worktree of this clone and not a link: a forced
 *  checkout throws away whatever is there, so a directory nobody made for a review is refused. */
async function ownedWorktree(deps: ReviewWorktreeDeps, clone: string, dir: string): Promise<string | null> {
  if (deps.isSymlink(dir)) return `${dir} is a symbolic link, not a review worktree`;
  const listed = await deps.git(["worktree", "list", "--porcelain"], clone);
  if (!listed.ok) return `could not list the worktrees of ${clone}`;
  return listsWorktree(listed.stdout, dir, deps.realpath) ? null : `${dir} exists and is not a worktree of ${clone}; remove it to review here`;
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
  const present = deps.exists(dir) || deps.isSymlink(dir);
  const refusal = present ? await ownedWorktree(deps, clone, dir) : null;
  if (refusal !== null) return refusal;
  const placed = present
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
