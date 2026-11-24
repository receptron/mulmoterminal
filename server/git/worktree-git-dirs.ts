import { git } from "./worktrees.js";
import { worktreeGitWritableRoots } from "../agents/codex/codex-git-roots.js";

/** The git metadata outside `cwd` that committing and pushing from it writes, or none when git
 *  cannot say (not a repository, a failed call): the agent then asks, as it would have before. */
export async function worktreeGitRoots(cwd: string): Promise<string[]> {
  const [dirs, worktreeConfig] = await Promise.all([
    git(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], cwd),
    git(["config", "--bool", "--get", "extensions.worktreeConfig"], cwd),
  ]);
  const [gitDir, commonDir] = dirs.ok ? dirs.stdout.split("\n").map((line) => line.trim()) : [];
  if (!gitDir || !commonDir) return [];
  return worktreeGitWritableRoots({ gitDir, commonDir, worktreeConfig: worktreeConfig.stdout.trim() === "true" });
}
