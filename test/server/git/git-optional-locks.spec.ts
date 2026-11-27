// @vitest-environment node
//
// #3556: our background `git status` polls refreshed a stale index and wrote it back under
// `.git/index.lock`, so a user's `git add` landing at the same moment failed with "File exists".
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withoutOptionalLocks } from "../../../server/git/git-env.js";
import { git } from "../../../server/git/worktrees.js";
import { runTool } from "../../../server/git/run-tool.js";

describe("withoutOptionalLocks", () => {
  it("turns optional locks off and keeps everything else", () => {
    expect(withoutOptionalLocks({ PATH: "/bin", HOME: "/h" })).toEqual({ PATH: "/bin", HOME: "/h", GIT_OPTIONAL_LOCKS: "0" });
  });

  it("overrides an inherited value that would turn them back on", () => {
    expect(withoutOptionalLocks({ GIT_OPTIONAL_LOCKS: "1" }).GIT_OPTIONAL_LOCKS).toBe("0");
  });

  it("works from an empty environment", () => {
    expect(withoutOptionalLocks({})).toEqual({ GIT_OPTIONAL_LOCKS: "0" });
  });

  it("does not modify the environment it was given", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/bin" };
    withoutOptionalLocks(base);
    expect(base).toEqual({ PATH: "/bin" });
  });
});

const MTIME_STEP_MS = 60_000;
const GIT_TIMEOUT_MS = 10_000;

describe("git() status and a stale index", () => {
  let repo = "";
  const indexPath = (): string => path.join(repo, ".git", "index");
  // `runTool` with no `env` inherits the runner's environment, as git() did before #3556. A runner
  // exporting GIT_OPTIONAL_LOCKS=0 fails the control below, which is the right answer: the git()
  // assertion would then prove nothing.
  const runPlain = async (args: string[]): Promise<void> => {
    const run = await runTool("git", ["-C", repo, ...args], { timeoutMs: GIT_TIMEOUT_MS });
    expect(run.code).toBe(0);
  };
  // Same content, new mtime: status sees the stat change, re-hashes, and (with optional locks on)
  // writes the refreshed entry back to the index.
  const staleCount = { n: 0 };
  const makeIndexStale = (): void => {
    staleCount.n += 1;
    const later = new Date(Date.now() + staleCount.n * MTIME_STEP_MS);
    utimesSync(path.join(repo, "tracked.txt"), later, later);
  };

  beforeAll(async () => {
    repo = mkdtempSync(path.join(tmpdir(), "mt-optional-locks-"));
    await runPlain(["init", "-q"]);
    writeFileSync(path.join(repo, "tracked.txt"), "content\n");
    await runPlain(["add", "tracked.txt"]);
    await runPlain(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init"]);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  // The control: without the setting, the same status really does rewrite the index, so the test
  // below is about the environment and not about a repository status never touches.
  it("a plain status rewrites the index", async () => {
    makeIndexStale();
    const before = readFileSync(indexPath());
    await runPlain(["status", "--porcelain"]);
    expect(readFileSync(indexPath()).equals(before)).toBe(false);
  });

  it("git() leaves the index as it was", async () => {
    makeIndexStale();
    const before = readFileSync(indexPath());
    const result = await git(["status", "--porcelain"], repo, GIT_TIMEOUT_MS);
    expect(result.ok).toBe(true);
    expect(readFileSync(indexPath()).equals(before)).toBe(true);
  });
});
