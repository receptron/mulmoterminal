import path from "node:path";

export interface WorktreeGitDirs {
  gitDir: string;
  commonDir: string;
  /** `extensions.worktreeConfig`: git then reads `config.worktree` inside the worktree's git dir. */
  worktreeConfig: boolean;
}

// The paths outside a linked worktree that git writes to commit, fetch and push from it. codex's
// workspace-write sandbox reaches only the working directory, and keeps any `.git` under a writable
// root read-only, so each is named itself. Anything git reads as config or hooks stays out: writing
// it (core.hooksPath, a hook) runs code outside the sandbox the next time anyone uses git in that
// clone. That rules out the clone's `config` and `hooks`, and the worktree's own git dir whenever
// it holds a `config.worktree` git reads. Without `config`, `push -u` cannot record the upstream;
// the push itself still lands.
export function worktreeGitWritableRoots({ gitDir, commonDir, worktreeConfig }: WorktreeGitDirs): string[] {
  if (worktreeConfig || path.resolve(gitDir) === path.resolve(commonDir)) return [];
  return [gitDir, ...["objects", "refs", "logs", "packed-refs", "packed-refs.lock"].map((name) => path.join(commonDir, name))];
}
