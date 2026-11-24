// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { worktreeGitWritableRoots } from "../../../../server/agents/codex/codex-git-roots.js";

const COMMON = path.join(path.sep, "repo", ".git");
const GIT_DIR = path.join(COMMON, "worktrees", "wt");

describe("worktreeGitWritableRoots", () => {
  it("names the worktree's own git dir and the shared stores a commit, fetch and push write", () => {
    expect(worktreeGitWritableRoots(GIT_DIR, COMMON)).toEqual([
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
    const roots = worktreeGitWritableRoots(GIT_DIR, COMMON);
    expect(roots.some((root) => /config|hooks/.test(path.basename(root)))).toBe(false);
    expect(roots).not.toContain(COMMON);
  });

  it("names nothing for a clone that is not a linked worktree, however the two are spelled", () => {
    expect(worktreeGitWritableRoots(COMMON, COMMON)).toEqual([]);
    expect(worktreeGitWritableRoots(`${COMMON}${path.sep}`, COMMON)).toEqual([]);
  });
});
