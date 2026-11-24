import { git } from "./worktrees.js";
import { worktreeGitWritableRoots } from "../agents/codex/codex-git-roots.js";

/** The git metadata outside `cwd` that committing and pushing from it writes, or none when git
 *  cannot say (not a repository, a failed call): the agent then asks, as it would have before. */
export async function worktreeGitRoots(cwd: string): Promise<string[]> {
  const dirs = await git(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], cwd);
  const [gitDir, commonDir] = dirs.ok ? dirs.stdout.split("\n").map((line) => line.trim()) : [];
  return gitDir && commonDir ? worktreeGitWritableRoots(gitDir, commonDir) : [];
}
