// @vitest-environment node
import { describe, it, expect } from "vitest";
import { realpathSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { git } from "../../../server/git/worktrees.js";
import { worktreeGitRoots } from "../../../server/git/worktree-git-dirs.js";

const run = async (cwd: string, ...args: string[]): Promise<void> => {
  const result = await git(args, cwd);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
};

describe("worktreeGitRoots", () => {
  it("answers a linked worktree with its git dir and the clone's shared stores", async () => {
    const root = realpathSync(makeTempDir("mt-wt-roots-"));
    const clone = path.join(root, "clone");
    await run(root, "init", "-q", "clone");
    await run(clone, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    await run(clone, "worktree", "add", "-q", path.join(root, "wt"), "-b", "issue/1");
    const roots = (await worktreeGitRoots(path.join(root, "wt"))).map((dir) => path.resolve(dir));
    const common = path.join(clone, ".git");
    expect(roots).toEqual([
      path.join(common, "worktrees", "wt"),
      ...["objects", "refs", "logs", "packed-refs", "packed-refs.lock"].map((name) => path.join(common, name)),
    ]);
    expect(await worktreeGitRoots(clone)).toEqual([]);
  });

  it("answers nothing outside a repository", async () => {
    expect(await worktreeGitRoots(makeTempDir("mt-wt-none-"))).toEqual([]);
  });
});
