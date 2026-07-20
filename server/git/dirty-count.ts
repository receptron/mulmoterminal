import { git } from "./worktrees.js";

// `git status --porcelain` lists staged/unstaged changes and untracked files one per
// line, so a count of non-blank lines is the number of uncommitted entries.
export async function dirtyCount(cwd: string): Promise<number> {
  const res = await git(["status", "--porcelain"], cwd);
  return res.ok ? res.stdout.split("\n").filter((l) => l.trim()).length : 0;
}
