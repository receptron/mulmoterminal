// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { listProjectFiles } from "../../../server/files/project-files";

const tmp = () => makeTempDir("mt-index-");

const write = (dir: string, rel: string, text = "x"): void => {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};

const git = (dir: string, ...args: string[]): void => {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
};

/** A real repository, because the whole point of the git branch is that GIT decides what is
 *  ignored — a fake would only test the parser we deliberately do not have.
 *
 *  No `user.name` / `user.email`: nothing here commits, and git asks for an identity only then.
 *  Every spawn shows up in this file's runtime — it is already the slowest in the directory. */
const repo = (): string => {
  const dir = tmp();
  git(dir, "init", "-q");
  return dir;
};

describe("listProjectFiles — in a git repository", () => {
  it("lists tracked and untracked files, and says git answered", async () => {
    const dir = repo();
    write(dir, "src/a.ts");
    write(dir, "README.md");
    git(dir, "add", "README.md");
    const index = await listProjectFiles(dir);
    expect(index.source).toBe("git");
    expect(index.paths).toEqual(["README.md", "src/a.ts"]);
  });

  // The request in #2099: node_modules must not be among the candidates.
  it("leaves out what .gitignore excludes", async () => {
    const dir = repo();
    write(dir, ".gitignore", "node_modules/\n*.log\n");
    write(dir, "node_modules/pkg/index.js");
    write(dir, "debug.log");
    write(dir, "src/a.ts");
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual([".gitignore", "src/a.ts"]);
  });

  // A nested ignore file is one of the reasons this asks git instead of reading `.gitignore`.
  it("honours an ignore file deeper in the tree", async () => {
    const dir = repo();
    write(dir, "pkg/.gitignore", "build/\n");
    write(dir, "pkg/build/out.js");
    write(dir, "pkg/src/a.ts");
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual(["pkg/.gitignore", "pkg/src/a.ts"]);
  });

  it("never lists .git itself", async () => {
    const dir = repo();
    write(dir, "a.ts");
    const index = await listProjectFiles(dir);
    expect(index.paths.some((p) => p.startsWith(".git/"))).toBe(false);
  });

  // The finder hands what it picks to the tree and the editor, which resolve against the pane's
  // ROOT. Asked about a subdirectory, the paths have to be relative to THAT — which is what
  // running git with `-C` buys, and what a repo-relative listing would get wrong at every depth.
  it("answers relative to the directory it was asked about, not the repository root", async () => {
    const dir = repo();
    write(dir, "pkg/sub/a.ts");
    write(dir, "outside.ts");
    const index = await listProjectFiles(path.join(dir, "pkg"));
    expect(index.paths).toEqual(["sub/a.ts"]);
  });

  // `git ls-files --cached` lists a tracked submodule as an ordinary index entry, but the path is a
  // DIRECTORY — the editor route answers 400 for one, so offering it is a row that opens nothing.
  // The gitlink is written straight into the index rather than through `git submodule add`, which
  // would need a remote to clone from (CodeRabbit on #2102).
  it("leaves out a tracked submodule, whose path is a directory", async () => {
    const dir = repo();
    write(dir, "src/a.ts");
    git(dir, "add", "src/a.ts");
    git(dir, "update-index", "--add", "--cacheinfo", "160000,0000000000000000000000000000000000000001,vendor/lib");
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual(["src/a.ts"]);
  });

  it("puts the tracked and the untracked halves together, complete", async () => {
    const dir = repo();
    write(dir, "src/a.ts");
    git(dir, "add", "src/a.ts");
    write(dir, "untracked.ts");
    expect(await listProjectFiles(dir)).toEqual({ paths: ["src/a.ts", "untracked.ts"], truncated: false, source: "git" });
  });

  // The whole symlink rule in one repository, tracked and untracked together: mode 120000 says a
  // path is a link but not whether it opens, and four of these five do not. Stated as one case
  // because it IS one rule — and because every `git` here is a subprocess this file pays for.
  it("keeps only the symlinks that resolve to a file inside the project", async () => {
    const outside = tmp();
    writeFileSync(path.join(outside, "elsewhere.ts"), "x");
    const dir = repo();
    write(dir, "real.ts");
    write(dir, "src/a.ts");
    symlinkSync(path.join(dir, "real.ts"), path.join(dir, "alias.ts")); // → a file: kept
    symlinkSync(path.join(dir, "src"), path.join(dir, "to-dir.ts")); // → a directory: /text is 400
    symlinkSync(path.join(dir, "gone.ts"), path.join(dir, "dangling.ts")); // → nothing: 404
    symlinkSync(path.join(outside, "elsewhere.ts"), path.join(dir, "escape.ts")); // → outside: 403
    git(dir, "add", "real.ts", "src/a.ts", "alias.ts", "to-dir.ts", "dangling.ts");
    // `escape.ts` is left untracked, so the same rule is proved on both halves of the listing.
    expect((await listProjectFiles(dir)).paths).toEqual(["alias.ts", "real.ts", "src/a.ts"]);
  });

  // The index is what git TRACKS, not what is on disk now, and the two diverge in ways no
  // `ls-files` query names. Both of these are rows that open nothing — 404 for the first, 400 for
  // the second (Codex on #2102).
  it("leaves out a tracked file that has been deleted from the worktree", async () => {
    const dir = repo();
    write(dir, "kept.ts");
    write(dir, "removed.ts");
    git(dir, "add", "kept.ts", "removed.ts");
    rmSync(path.join(dir, "removed.ts"));
    expect((await listProjectFiles(dir)).paths).toEqual(["kept.ts"]);
  });

  // The case that decided the design: `git ls-files --deleted` reports NOTHING here, while
  // `git status` says `AD`. Asking the filesystem covers it, and costs less than the subprocess it
  // replaced.
  it("leaves out a tracked path the worktree has turned into a directory", async () => {
    const dir = repo();
    write(dir, "kept.ts");
    write(dir, "swapped.ts");
    git(dir, "add", "kept.ts", "swapped.ts");
    rmSync(path.join(dir, "swapped.ts"));
    mkdirSync(path.join(dir, "swapped.ts"));
    expect((await listProjectFiles(dir)).paths).toEqual(["kept.ts"]);
  });

  it("keeps a path holding a space or a non-ASCII name intact", async () => {
    const dir = repo();
    write(dir, "docs/my notes.md");
    write(dir, "docs/日本語.md");
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual(["docs/my notes.md", "docs/日本語.md"]);
  });
});

describe("listProjectFiles — where git has nothing to say", () => {
  it("walks the directory and says so, so the UI can admit .gitignore was not applied", async () => {
    const dir = tmp();
    write(dir, "a.ts");
    write(dir, "deep/b/c.ts");
    const index = await listProjectFiles(dir);
    expect(index.source).toBe("walk");
    expect(index.paths).toEqual(["a.ts", "deep/b/c.ts"]);
  });

  it("does not descend into the directories that are never worth walking", async () => {
    const dir = tmp();
    write(dir, "node_modules/pkg/index.js");
    write(dir, "src/a.ts");
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual(["src/a.ts"]);
  });

  // A link pointing at an ancestor is a walk that never ends.
  it("does not follow a symlinked directory, and does not offer it either", async () => {
    const dir = tmp();
    write(dir, "real.ts");
    symlinkSync(dir, path.join(dir, "loop"));
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual(["real.ts"]);
  });

  // The file it points at opens normally; the route's containment check is what refuses one that
  // leaves the project, and that belongs there rather than here.
  it("offers a symlink that resolves to a file", async () => {
    const dir = tmp();
    write(dir, "real.ts");
    symlinkSync(path.join(dir, "real.ts"), path.join(dir, "alias.ts"));
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual(["alias.ts", "real.ts"]);
  });

  // A row that opens nothing is worse than a row that is absent.
  it("leaves out a broken symlink", async () => {
    const dir = tmp();
    write(dir, "real.ts");
    symlinkSync(path.join(dir, "gone.ts"), path.join(dir, "dangling.ts"));
    const index = await listProjectFiles(dir);
    expect(index.paths).toEqual(["real.ts"]);
  });

  it("reports nothing for an empty directory rather than failing", async () => {
    expect(await listProjectFiles(tmp())).toEqual({ paths: [], truncated: false, source: "walk" });
  });

  it("survives a directory it cannot read", async () => {
    const dir = tmp();
    write(dir, "a.ts");
    expect((await listProjectFiles(path.join(dir, "missing"))).paths).toEqual([]);
  });
});

describe("listProjectFiles — the cap", () => {
  it("cuts the list and SAYS it cut it", async () => {
    const dir = tmp();
    ["a.ts", "b.ts", "c.ts"].forEach((name) => write(dir, name));
    const index = await listProjectFiles(dir, 2);
    expect(index).toEqual({ paths: ["a.ts", "b.ts"], truncated: true, source: "walk" });
  });

  it("is not truncated when the list exactly fills the cap", async () => {
    const dir = tmp();
    ["a.ts", "b.ts"].forEach((name) => write(dir, name));
    expect((await listProjectFiles(dir, 2)).truncated).toBe(false);
  });

  // The walk can stop on its ENTRY budget while holding fewer paths than the cap — a directory of
  // directories spends the budget without yielding files. The array's own length cannot reveal
  // that, so an incomplete list would be reported as the whole project (CodeRabbit on #2102).
  it("says it is truncated when the walk ran out of budget, even below the path cap", async () => {
    const dir = tmp();
    ["deep/a/one.ts", "deep/b/two.ts", "deep/c/three.ts"].forEach((rel) => write(dir, rel));
    const index = await listProjectFiles(dir, 1000, 3);
    expect(index.paths.length).toBeLessThan(1000);
    expect(index.truncated).toBe(true);
  });

  // A subtree nobody could read is missing from the answer exactly as a budget-stopped one is, and
  // the array's length reveals neither (Codex on #2102).
  //
  // POSIX only, and the skip is about how the case is PROVOKED rather than about the behaviour:
  // `readDirSafely` answering null is platform-independent, but `chmod 000` is not a way to make a
  // directory unreadable anywhere else. On Windows Node's `chmod` only toggles the read-only bit
  // and a directory stays listable, so the walk succeeds and the assertion reads as a bug in the
  // code (it did, on CI). Root is skipped for the same reason — the mode does not stop it.
  const cannotLockADirectory = process.platform === "win32" || process.getuid?.() === 0;
  it.skipIf(cannotLockADirectory)("says it is truncated when a subtree could not be read", async () => {
    const dir = tmp();
    write(dir, "readable.ts");
    write(dir, "locked/hidden.ts");
    chmodSync(path.join(dir, "locked"), 0o000);
    try {
      const index = await listProjectFiles(dir);
      expect(index.paths).toEqual(["readable.ts"]);
      expect(index.truncated).toBe(true);
    } finally {
      chmodSync(path.join(dir, "locked"), 0o755); // or the temp-dir sweep cannot remove it
    }
  });

  // The opposite: what UNWALKED_DIRS leaves out is a DECISION, not a failure. Reporting it as
  // truncation would mark every non-git project incomplete and the flag would mean nothing.
  it("is not truncated merely because a noisy directory was skipped", async () => {
    const dir = tmp();
    write(dir, "src/a.ts");
    write(dir, "node_modules/pkg/index.js");
    expect(await listProjectFiles(dir)).toEqual({ paths: ["src/a.ts"], truncated: false, source: "walk" });
  });

  // The boundary: a tree holding EXACTLY the budget is walked in full and ends on zero with nothing
  // left to see. Reading the counter rather than "did it stop" called that complete list truncated
  // (Codex on #2102).
  it("is not truncated when the tree holds exactly the entry budget", async () => {
    const dir = tmp();
    ["a.ts", "b.ts"].forEach((name) => write(dir, name));
    expect(await listProjectFiles(dir, 1000, 2)).toEqual({ paths: ["a.ts", "b.ts"], truncated: false, source: "walk" });
  });

  it("is truncated at one entry less than the tree holds", async () => {
    const dir = tmp();
    ["a.ts", "b.ts"].forEach((name) => write(dir, name));
    expect(await listProjectFiles(dir, 1000, 1)).toEqual({ paths: ["a.ts"], truncated: true, source: "walk" });
  });

  // A directory the budget never opened is a directory whose contents are missing, even though
  // nothing inside it was counted.
  it("is truncated when the budget ran out before a subdirectory was opened", async () => {
    const dir = tmp();
    write(dir, "sub/inside.ts");
    expect((await listProjectFiles(dir, 1000, 1)).truncated).toBe(true);
  });

  // The two cases where the flag deliberately over-reports. Pinned so the choice is a decision on
  // the record rather than an oversight: telling an empty directory from an omitted one means
  // READING it, which is the syscall the budget exists to prevent. `truncated` says "this may not
  // be everything", and the failure that matters is silence when something IS missing.
  it("is truncated when the budget stops at a directory, even one that turns out to be empty", async () => {
    const dir = tmp();
    write(dir, "a.ts");
    mkdirSync(path.join(dir, "empty"));
    // Two entries, one of budget: whichever is visited second is left unopened.
    expect((await listProjectFiles(dir, 1000, 1)).truncated).toBe(true);
  });

  it("is truncated with a budget of zero, which establishes nothing about the directory", async () => {
    expect(await listProjectFiles(tmp(), 1000, 0)).toEqual({ paths: [], truncated: true, source: "walk" });
  });

  it("is not truncated when the walk finished inside its budget", async () => {
    const dir = tmp();
    write(dir, "a.ts");
    expect((await listProjectFiles(dir, 1000, 1000)).truncated).toBe(false);
  });
});

// The one branch a real repository cannot be talked into: the tracked half answers and the
// untracked half does not. Falling back to the walk there would put `node_modules` in front of
// someone whose repository plainly has a `.gitignore`, which is worse than a list that is short
// and says so.
//
// `vi.doMock` is not hoisted, so the module under test is imported INSIDE the case — the exception
// this repo's CLAUDE.md names for exactly this shape.
describe("listProjectFiles — when only half of git answers", () => {
  // BEFORE the mock, not after: this file already imported the module under test at the top, so
  // its graph is cached with the real `git` in it. Clearing first is what makes the dynamic import
  // below re-evaluate against the mock rather than hand back the cached copy.
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("../../../server/git/worktrees.js");
    vi.resetModules();
  });

  it("keeps the tracked half and reports it as partial", async () => {
    vi.doMock("../../../server/git/worktrees.js", () => ({
      git: async (args: string[]) => (args.includes("--stage") ? { ok: true, stdout: "100644 abc 0\tsrc/a.ts\0" } : { ok: false, stdout: "" }),
    }));
    const { listProjectFiles: subject } = await import("../../../server/files/project-files");
    // The path has to be REAL: what git tracks is checked against the filesystem, which is the
    // whole point of `offerableFile`.
    const dir = tmp();
    write(dir, "src/a.ts");
    expect(await subject(dir)).toEqual({ paths: ["src/a.ts"], truncated: true, source: "git" });
  });

  it("falls back to the walk when git cannot answer at all", async () => {
    vi.doMock("../../../server/git/worktrees.js", () => ({ git: async () => ({ ok: false, stdout: "" }) }));
    const { listProjectFiles: subject } = await import("../../../server/files/project-files");
    const dir = tmp();
    write(dir, "only.ts");
    expect(await subject(dir)).toEqual({ paths: ["only.ts"], truncated: false, source: "walk" });
  });
});
