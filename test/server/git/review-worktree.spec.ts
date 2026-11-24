// @vitest-environment node
// The checkout a reviewer works in (#3425): the PR's head in a worktree of its own, made once and
// moved after, and removed at the end — every git call asked from the right directory, and a forced
// checkout only ever in a worktree this clone owns.
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  checkoutReviewHead,
  listsWorktree,
  removeReviewWorktree,
  reviewWorktreeDir,
  type GitRun,
  type ReviewWorktreeDeps,
} from "../../../server/git/review-worktree.js";

const CLONE = "/src/repo";
const DIR = "/review/owner-repo-pr7";
const HEAD = "a".repeat(40);
const porcelainOf = (...dirs: string[]): string => dirs.map((dir) => `worktree ${dir}\nHEAD ${HEAD}\ndetached\n`).join("\n");

interface Fake {
  failOn?: string;
  present?: boolean;
  symlink?: boolean;
  listed?: string[];
}

function fake({ failOn, present = false, symlink = false, listed = [CLONE, DIR] }: Fake = {}): { deps: ReviewWorktreeDeps; calls: [string, string][] } {
  const calls: [string, string][] = [];
  const git: GitRun = async (args, cwd) => {
    calls.push([cwd, args.join(" ")]);
    const ok = failOn === undefined || !args.includes(failOn);
    return { ok, stdout: ok && args[1] === "list" ? porcelainOf(...listed) : "" };
  };
  return { deps: { git, exists: () => present, isSymlink: () => symlink, realpath: (p) => p }, calls };
}

describe("reviewWorktreeDir", () => {
  it("is one directory per PR under the root", () => {
    expect(reviewWorktreeDir("/root", "owner/repo", 7)).toBe(path.join("/root", "owner-repo-pr7"));
    expect(reviewWorktreeDir("/root", "owner/repo", 8)).not.toBe(reviewWorktreeDir("/root", "owner/repo", 7));
  });

  it("keeps a repository name that would leave the root inside it", () => {
    const dir = reviewWorktreeDir("/root", "../etc", 1);
    expect(path.dirname(dir)).toBe(path.join("/root"));
    expect(path.basename(dir)).not.toMatch(/[/\\]/);
  });
});

describe("listsWorktree", () => {
  it("finds the directory among the listed worktrees, by real path", () => {
    expect(listsWorktree(porcelainOf(CLONE, DIR), DIR, (p) => p)).toBe(true);
    expect(listsWorktree(porcelainOf("/private/review/x"), "/review/x", (p) => (p.startsWith("/review") ? `/private${p}` : p))).toBe(true);
  });

  it.each([
    ["no worktree of that path", porcelainOf(CLONE, "/review/other")],
    ["a path only as a prefix", porcelainOf(`${DIR}-old`)],
    ["the path on a line that is not a worktree line", `HEAD ${DIR}\nbranch ${DIR}`],
    ["nothing listed", ""],
  ])("is false for %s", (_label, porcelain) => {
    expect(listsWorktree(porcelain, DIR, (p) => p)).toBe(false);
  });

  it("skips a listed worktree whose path no longer resolves", () => {
    const realpath = (p: string): string => {
      if (p === "/gone") throw new Error("ENOENT");
      return p;
    };
    expect(listsWorktree(porcelainOf("/gone", DIR), DIR, realpath)).toBe(true);
  });
});

describe("checkoutReviewHead", () => {
  it("fetches the PR's head into the clone and adds a detached worktree on it", async () => {
    const { deps, calls } = fake();
    expect(await checkoutReviewHead(deps, CLONE, DIR, 7, HEAD)).toBeNull();
    expect(calls).toEqual([
      [CLONE, "fetch --quiet origin pull/7/head"],
      [CLONE, `worktree add --quiet --detach ${DIR} ${HEAD}`],
    ]);
  });

  it("moves a worktree of this clone that is already there, from inside it", async () => {
    const { deps, calls } = fake({ present: true });
    expect(await checkoutReviewHead(deps, CLONE, DIR, 7, HEAD)).toBeNull();
    expect(calls.at(-1)).toEqual([DIR, `checkout --quiet --force --detach ${HEAD}`]);
  });

  it.each<[string, Fake, RegExp]>([
    ["a directory that is no worktree of the clone", { present: true, listed: [CLONE] }, /exists and is not a worktree of/],
    ["a symbolic link, even to a listed worktree", { present: true, symlink: true }, /symbolic link/],
    ["a dangling symbolic link", { present: false, symlink: true }, /symbolic link/],
    ["a clone whose worktrees cannot be listed", { present: true, failOn: "list" }, /could not list the worktrees/],
  ])("refuses %s, forcing nothing", async (_label, setup, reason) => {
    const { deps, calls } = fake(setup);
    expect(await checkoutReviewHead(deps, CLONE, DIR, 7, HEAD)).toMatch(reason);
    expect(calls.some(([, args]) => args.startsWith("checkout") || args.startsWith("worktree add"))).toBe(false);
  });

  it("stops at a failed fetch, touching no worktree", async () => {
    const { deps, calls } = fake({ failOn: "fetch" });
    expect(await checkoutReviewHead(deps, CLONE, DIR, 7, HEAD)).toMatch(/could not fetch pull\/7\/head/);
    expect(calls).toHaveLength(1);
  });

  it.each<[boolean, string]>([
    [false, "add"],
    [true, "checkout"],
  ])("says so when the head cannot be checked out (worktree present: %s)", async (present, failOn) => {
    const { deps } = fake({ present, failOn });
    expect(await checkoutReviewHead(deps, CLONE, DIR, 7, HEAD)).toMatch(/could not check out/);
  });
});

describe("removeReviewWorktree", () => {
  it("removes it through the clone, forcing past the reviewer's scratch edits", async () => {
    const { deps, calls } = fake({ present: true });
    expect(await removeReviewWorktree(deps, CLONE, DIR)).toBeNull();
    expect(calls).toEqual([[CLONE, `worktree remove --force ${DIR}`]]);
  });

  it("is done already when the directory is gone", async () => {
    const { deps, calls } = fake();
    expect(await removeReviewWorktree(deps, CLONE, DIR)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("says so when git refuses", async () => {
    const { deps } = fake({ present: true, failOn: "remove" });
    expect(await removeReviewWorktree(deps, CLONE, DIR)).toMatch(/could not remove/);
  });
});
