import { describe, it, expect } from "vitest";
import path from "node:path";
import { repoFromWebUrl, worktreeTask } from "../../../server/config/header-context.js";

describe("repoFromWebUrl", () => {
  it("extracts owner/repo from a github web url", () => {
    expect(repoFromWebUrl("https://github.com/receptron/mulmoterminal")).toBe("receptron/mulmoterminal");
  });
  it("strips a trailing .git and slashes", () => {
    expect(repoFromWebUrl("https://github.com/o/r.git")).toBe("o/r");
    expect(repoFromWebUrl("https://github.com/o/r/")).toBe("o/r");
  });
  it("returns null for a null input or a non-github url", () => {
    expect(repoFromWebUrl(null)).toBeNull();
    expect(repoFromWebUrl("https://gitlab.com/o/r")).toBeNull();
  });
});

describe("worktreeTask", () => {
  const root = path.join("/home", "u", ".mulmoterminal", "worktrees");
  const wt = (...segs: string[]) => path.join(root, ...segs);

  it("returns the task for the worktree's own dir", () => {
    expect(worktreeTask(wt("myrepo-abc123", "fix-login"), root)).toBe("fix-login");
  });

  // Regression (#748): path.basename returned the wrong name for any cwd deeper than the
  // task dir — the task is the FIRST segment under <root>/<repo>-<hash>, at any depth.
  it("returns the task for a subdirectory inside the worktree", () => {
    expect(worktreeTask(wt("myrepo-abc123", "fix-login", "src", "components"), root)).toBe("fix-login");
  });

  it("returns null for a path outside the worktrees root", () => {
    expect(worktreeTask(path.join("/home", "u", "projects", "myrepo"), root)).toBeNull();
  });

  it("returns null for the repo-hash dir itself (no task segment yet)", () => {
    expect(worktreeTask(wt("myrepo-abc123"), root)).toBeNull();
  });
});
