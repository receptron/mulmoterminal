// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { worktreeGitWritableRoots } from "../../../../server/agents/codex/codex-git-roots.js";

const COMMON = path.join(path.sep, "repo", ".git");
const GIT_DIR = path.join(COMMON, "worktrees", "wt");
const LINKED = { gitDir: GIT_DIR, commonDir: COMMON, worktreeConfig: false };

describe("worktreeGitWritableRoots", () => {
  it("names the worktree's own git dir and the shared stores a commit, fetch and push write", () => {
    expect(worktreeGitWritableRoots(LINKED)).toEqual([
      GIT_DIR,
      path.join(COMMON, "objects"),
      path.join(COMMON, "refs"),
      path.join(COMMON, "logs"),
      path.join(COMMON, "packed-refs"),
      path.join(COMMON, "packed-refs.lock"),
    ]);
  });

  // Either would run code outside the sandbox the next time anyone uses git in the clone.
  it("never names the clone's config or hooks", () => {
    const roots = worktreeGitWritableRoots(LINKED);
    expect(roots.some((root) => /config|hooks/.test(path.basename(root)))).toBe(false);
    expect(roots).not.toContain(COMMON);
  });

  it("names nothing for a clone that is not a linked worktree, however the two are spelled", () => {
    expect(worktreeGitWritableRoots({ ...LINKED, gitDir: COMMON })).toEqual([]);
    expect(worktreeGitWritableRoots({ ...LINKED, gitDir: `${COMMON}${path.sep}` })).toEqual([]);
  });

  // git then reads config.worktree in the worktree's own git dir, so writing it could set core.hooksPath.
  it("names nothing when the clone reads per-worktree config", () => {
    expect(worktreeGitWritableRoots({ ...LINKED, worktreeConfig: true })).toEqual([]);
  });
});
