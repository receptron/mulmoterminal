// @vitest-environment node
// An implementer's worktree goes when it is closed (#3428). What must not happen is work lost: a
// worktree with uncommitted changes, or with commits no remote has, stays.
import { makeTempDir } from "../../support/tempDir.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { rmDirRetrying, GIT_TEST_TIMEOUT_MS } from "./wtTestUtil.js";
import { createWorktree, git, gitTopLevel } from "../../../server/git/worktrees";
import { removeImplementerWorktree, worktreeFacts } from "../../../server/git/implementer-worktree";

const hasGit = (() => {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
const run = (dir: string, ...args: string[]): void => void execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });

function commit(dir: string, file: string): void {
  writeFileSync(path.join(dir, file), file);
  run(dir, "add", file);
  run(dir, "commit", "-m", file);
}

describe.skipIf(!hasGit)("removeImplementerWorktree", () => {
  let home: string;
  let repo: string;
  let remote: string;

  beforeEach(async () => {
    home = makeTempDir("mt-iw-home-");
    process.env.MULMOTERMINAL_HOME = home;
    remote = makeTempDir("mt-iw-remote-");
    run(remote, "init", "--bare", "-b", "main");
    repo = makeTempDir("mt-iw-repo-");
    run(repo, "init", "-b", "main");
    run(repo, "config", "user.email", "t@t.t");
    run(repo, "config", "user.name", "t");
    commit(repo, "README.md");
    run(repo, "remote", "add", "origin", remote);
    run(repo, "push", "-u", "origin", "main");
    repo = (await gitTopLevel(repo)) ?? repo;
  });
  afterEach(() => {
    delete process.env.MULMOTERMINAL_HOME;
    [home, repo, remote].forEach(rmDirRetrying);
  });

  async function worktreeWithPushedCommit(): Promise<{ path: string; branch: string }> {
    const wt = await createWorktree(repo, "thing", 7);
    if (!wt) throw new Error("expected a worktree");
    commit(wt.path, "work.txt");
    run(wt.path, "push", "-u", "origin", wt.branch);
    return wt;
  }

  it(
    "removes a pushed worktree and its local branch, and leaves the remote branch",
    async () => {
      const wt = await worktreeWithPushedCommit();
      expect(await worktreeFacts(wt.path)).toEqual({ exists: true, dirty: false, unpushed: 0 });
      expect(await removeImplementerWorktree(wt.path)).toEqual({ removed: true });
      expect(existsSync(wt.path)).toBe(false);
      expect((await git(["branch", "--list", wt.branch], repo)).stdout.trim()).toBe("");
      expect((await git(["branch", "--list", wt.branch], remote)).stdout.trim()).not.toBe("");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "keeps a worktree with a commit no remote has",
    async () => {
      const wt = await worktreeWithPushedCommit();
      commit(wt.path, "later.txt");
      expect(await removeImplementerWorktree(wt.path)).toEqual({ removed: false, reason: "it has commits no remote has (1)" });
      expect(existsSync(wt.path)).toBe(true);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "keeps a worktree whose branch was never pushed",
    async () => {
      const wt = await createWorktree(repo, "thing", 8);
      if (!wt) throw new Error("expected a worktree");
      commit(wt.path, "work.txt");
      expect(await removeImplementerWorktree(wt.path)).toEqual({ removed: false, reason: "it has commits no remote has (1)" });
      expect(existsSync(wt.path)).toBe(true);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "keeps a worktree with uncommitted changes, tracked or not",
    async () => {
      const wt = await worktreeWithPushedCommit();
      writeFileSync(path.join(wt.path, "scratch.txt"), "x");
      expect(await removeImplementerWorktree(wt.path)).toEqual({ removed: false, reason: "it has uncommitted changes" });
      expect(existsSync(wt.path)).toBe(true);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it("does nothing for a worktree that is already gone", async () => {
    expect(await removeImplementerWorktree(path.join(home, "nowhere"))).toEqual({ removed: false, reason: "it is already gone" });
  });

  it("keeps a directory git cannot read", async () => {
    const plain = makeTempDir("mt-iw-plain-");
    try {
      expect(await removeImplementerWorktree(plain)).toEqual({ removed: false, reason: "git could not say whether it holds unpushed work" });
      expect(existsSync(plain)).toBe(true);
    } finally {
      rmDirRetrying(plain);
    }
  });
});
