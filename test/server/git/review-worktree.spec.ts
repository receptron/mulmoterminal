// @vitest-environment node
// The checkout a reviewer works in (#3425): the PR's head in a worktree of its own, made once and
// moved after, and removed at the end — every git call asked from the right directory.
import { describe, it, expect } from "vitest";
import path from "node:path";
import { checkoutReviewHead, removeReviewWorktree, reviewWorktreeDir, type GitRun } from "../../../server/git/review-worktree.js";

const CLONE = "/src/repo";
const DIR = "/review/owner-repo-pr7";
const HEAD = "a".repeat(40);

function fakeGit(failOn: string | null = null): { git: GitRun; calls: [string, string][] } {
  const calls: [string, string][] = [];
  const git: GitRun = async (args, cwd) => {
    calls.push([cwd, args.join(" ")]);
    return { ok: failOn === null || !args.includes(failOn), stdout: "" };
  };
  return { git, calls };
}

describe("reviewWorktreeDir", () => {
  it("is one directory per PR under the root", () => {
    expect(reviewWorktreeDir("/root", "owner/repo", 7)).toBe(path.join("/root", "owner-repo-pr7"));
    expect(reviewWorktreeDir("/root", "owner/repo", 8)).not.toBe(reviewWorktreeDir("/root", "owner/repo", 7));
  });

  it("keeps a repository name that would leave the root inside it", () => {
    const dir = reviewWorktreeDir("/root", "../etc", 1);
    expect(path.dirname(dir)).toBe("/root");
    expect(path.basename(dir)).not.toMatch(/\//);
  });
});

describe("checkoutReviewHead", () => {
  it("fetches the PR's head into the clone and adds a detached worktree on it", async () => {
    const { git, calls } = fakeGit();
    expect(await checkoutReviewHead({ git, exists: () => false }, CLONE, DIR, 7, HEAD)).toBeNull();
    expect(calls).toEqual([
      [CLONE, "fetch --quiet origin pull/7/head"],
      [CLONE, `worktree add --quiet --detach ${DIR} ${HEAD}`],
    ]);
  });

  it("moves a worktree that is already there, from inside it", async () => {
    const { git, calls } = fakeGit();
    expect(await checkoutReviewHead({ git, exists: () => true }, CLONE, DIR, 7, HEAD)).toBeNull();
    expect(calls[1]).toEqual([DIR, `checkout --quiet --force --detach ${HEAD}`]);
  });

  it("stops at a failed fetch, touching no worktree", async () => {
    const { git, calls } = fakeGit("fetch");
    expect(await checkoutReviewHead({ git, exists: () => false }, CLONE, DIR, 7, HEAD)).toMatch(/could not fetch pull\/7\/head/);
    expect(calls).toHaveLength(1);
  });

  it.each([
    [false, "worktree"],
    [true, "checkout"],
  ])("says so when the head cannot be checked out (worktree present: %s)", async (present, failing) => {
    const { git } = fakeGit(failing);
    expect(await checkoutReviewHead({ git, exists: () => present }, CLONE, DIR, 7, HEAD)).toMatch(/could not check out/);
  });
});

describe("removeReviewWorktree", () => {
  it("removes it through the clone, forcing past the reviewer's scratch edits", async () => {
    const { git, calls } = fakeGit();
    expect(await removeReviewWorktree({ git, exists: () => true }, CLONE, DIR)).toBeNull();
    expect(calls).toEqual([[CLONE, `worktree remove --force ${DIR}`]]);
  });

  it("is done already when the directory is gone", async () => {
    const { git, calls } = fakeGit();
    expect(await removeReviewWorktree({ git, exists: () => false }, CLONE, DIR)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("says so when git refuses", async () => {
    const { git } = fakeGit("remove");
    expect(await removeReviewWorktree({ git, exists: () => true }, CLONE, DIR)).toMatch(/could not remove/);
  });
});
