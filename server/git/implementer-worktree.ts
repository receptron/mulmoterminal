// An implementer's worktree, removed when closeIssueSession or the watch closes it (#3428) — but only
// when nothing in it is missing from a remote, since its PR may have been closed on unfinished work.
import { existsSync } from "node:fs";
import { git, removeWorktree } from "./worktrees.js";
import { releaseWorktreeEnv } from "../config/worktree/worktree-env.js";
import { worktreeVerdict, type WorktreeFacts, type WorktreeOutcome } from "../routes/issueSessionClose.js";

async function dirtyOf(worktree: string): Promise<boolean | null> {
  const status = await git(["status", "--porcelain"], worktree);
  return status.ok ? status.stdout.trim().length > 0 : null;
}

/** Commits reachable from HEAD that no remote-tracking ref holds: pushed work is on a remote, the rest is not. */
async function unpushedOf(worktree: string): Promise<number | null> {
  const listed = await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], worktree);
  const count = Number(listed.stdout.trim());
  return listed.ok && Number.isInteger(count) ? count : null;
}

export async function worktreeFacts(worktree: string): Promise<WorktreeFacts> {
  if (!existsSync(worktree)) return { exists: false, dirty: false, unpushed: 0 };
  const [dirty, unpushed] = await Promise.all([dirtyOf(worktree), unpushedOf(worktree)]);
  return { exists: true, dirty, unpushed };
}

/** The worktree and its local branch, removed as the worktree routes remove one; the remote branch stays. */
export async function removeImplementerWorktree(worktree: string): Promise<WorktreeOutcome> {
  const verdict = worktreeVerdict(await worktreeFacts(worktree));
  if (!verdict.remove) return { removed: false, reason: verdict.reason };
  const result = await removeWorktree(worktree, worktree, { deleteBranch: true });
  if (!result.ok) return { removed: false, reason: `git would not remove it (${result.reason ?? "failed"})` };
  releaseWorktreeEnv(worktree);
  return { removed: true };
}
