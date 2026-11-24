import path from "node:path";

// The paths outside a linked worktree that git writes to commit, fetch and push from it. codex's
// workspace-write sandbox reaches only the working directory, and keeps any `.git` under a writable
// root read-only, so each is named itself. The clone's `config` and `hooks` are left out on
// purpose: writing either (core.hooksPath, a hook) runs code outside the sandbox the next time
// anyone uses git in that clone. Without `config`, `push -u` cannot record the upstream; the push
// itself still lands.
export function worktreeGitWritableRoots(gitDir: string, commonDir: string): string[] {
  if (path.resolve(gitDir) === path.resolve(commonDir)) return [];
  return [gitDir, ...["objects", "refs", "logs", "packed-refs", "packed-refs.lock"].map((name) => path.join(commonDir, name))];
}
