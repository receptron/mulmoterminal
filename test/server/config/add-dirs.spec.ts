import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveAddDirs, MAX_ADD_DIRS } from "../../../server/config/config-schema";
import { buildClaudeArgs } from "../../../server/agents/claude-args";
import { buildDockerRunArgs } from "../../../server/infra/sandbox";

// Built through `path.resolve`, never written as "/repo": the rule resolves with the platform's
// own path module, so on Windows a literal POSIX string never matches what it produces
// (`path.resolve("/repo", "../shared-lib")` is `D:\shared-lib` there). The daily Windows job
// caught this — five cases compared resolved paths against hard-coded POSIX ones.
const BASE = path.resolve("/repo");
const SIBLING = path.resolve(BASE, "../shared-lib");
const DOCS = path.resolve("/abs/docs");
const MISSING = path.resolve("/gone");
const DENIED = path.resolve("/denied");

// The existence check is a parameter so the rule is testable without touching a disk.
const exists = (present: string[]) => (p: string) => present.includes(p);

describe("resolveAddDirs", () => {
  it("resolves a relative entry against the config's own directory, not the process cwd", () => {
    // A managed worktree runs from ~/.mulmoterminal/worktrees/…; "../shared-lib" has to keep
    // meaning the sibling of the repo the config lives in.
    expect(resolveAddDirs(["../shared-lib"], BASE, exists([SIBLING]))).toEqual([SIBLING]);
  });

  it("keeps an absolute entry as-is", () => {
    expect(resolveAddDirs([DOCS], BASE, exists([DOCS]))).toEqual([DOCS]);
  });

  it("drops a path that does not exist rather than passing it on", () => {
    // Passed through, the flag would look applied while the agent sees nothing.
    expect(resolveAddDirs([MISSING, DOCS], BASE, exists([DOCS]))).toEqual([DOCS]);
  });

  it("drops the workspace itself — already the cwd, and a duplicate container mount", () => {
    expect(resolveAddDirs([BASE, "./"], BASE, exists([BASE]))).toBeNull();
  });

  it("de-duplicates entries that resolve to the same directory", () => {
    expect(resolveAddDirs([DOCS, DOCS, `${DOCS}${path.sep}`], BASE, exists([DOCS]))).toEqual([DOCS]);
  });

  it.each([
    ["not an array", "nope"],
    ["absent", undefined],
    ["empty", []],
    ["only junk", [1, "", "   ", null]],
  ])("is null when the value is %s", (_case, input) => {
    expect(resolveAddDirs(input, BASE, () => true)).toBeNull();
  });

  // Codex review on #912: the real predicate is `statSync(...).isDirectory()`, which throws on
  // EACCES or if the path vanishes mid-check. It runs inside loadDirConfig's outer try, so an
  // escaping throw would drop the WHOLE directory config — colors, sound, skills — over one
  // unreadable entry.
  it("drops only the entry whose existence check throws", () => {
    const exists = (p: string) => {
      if (p === DENIED) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return true;
    };
    expect(resolveAddDirs([DENIED, DOCS], BASE, exists)).toEqual([DOCS]);
  });

  it("is null — not a throw — when every entry's check throws", () => {
    expect(
      resolveAddDirs([DENIED], BASE, () => {
        throw new Error("EACCES");
      }),
    ).toBeNull();
  });

  // argv rides a tmux `new-session` command, which has a length limit this repo has already hit.
  it("caps the list", () => {
    const many = Array.from({ length: MAX_ADD_DIRS + 5 }, (_, i) => `/d${i}`);
    expect(resolveAddDirs(many, BASE, () => true)).toHaveLength(MAX_ADD_DIRS);
  });
});

describe("buildClaudeArgs with addDirs", () => {
  const base = {
    sessionId: "s1",
    resume: null,
    canResume: false,
    settings: "/cfg/settings.json",
    permissionMode: "auto",
    attachGuiMcp: false,
    mcpConfig: "{}",
    allowedTools: "",
    // Nothing to append: these cases are about where --add-dir sits, and the flag it must not
    // end up behind is exercised in claude-args.spec.
    appendedPrompt: null,
  };

  it("passes one variadic flag holding every directory", () => {
    const args = buildClaudeArgs({ ...base, addDirs: ["/a", "/b"] });
    expect(args).toContain("--add-dir");
    expect(args.slice(args.indexOf("--add-dir") + 1)).toEqual(["/a", "/b"]);
  });

  // `--add-dir <directories...>` is variadic: a VALUE after it would be swallowed into the list.
  it("puts the flag last, so nothing can follow it", () => {
    const args = buildClaudeArgs({ ...base, addDirs: ["/a"], model: "opus", attachGuiMcp: true, allowedTools: "t" });
    expect(args[args.length - 2]).toBe("--add-dir");
    expect(args[args.length - 1]).toBe("/a");
  });

  it("passes them on resume too", () => {
    const args = buildClaudeArgs({ ...base, canResume: true, resume: "r1", addDirs: ["/a"] });
    expect(args).toContain("--resume");
    expect(args).toContain("--add-dir");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", []],
  ])("adds no flag when the list is %s", (_case, addDirs) => {
    expect(buildClaudeArgs({ ...base, addDirs })).not.toContain("--add-dir");
  });
});

describe("buildDockerRunArgs with addDirs", () => {
  const run = (addDirs: string[] | null) => buildDockerRunArgs("s1", ["--session-id", "s1"], "/work", "/cfg/claude.json", null, addDirs);
  const mounts = (args: string[]) => args.filter((_value, i) => args[i - 1] === "-v");

  // Without the mount the flag names a path the container does not have: the agent sees
  // nothing and nothing errors — the worst way for this to break.
  it("bind-mounts each extra directory at its same absolute path", () => {
    expect(mounts(run(["/shared-lib"]))).toContain("/shared-lib:/shared-lib");
  });

  it("still mounts the workspace", () => {
    expect(mounts(run(["/shared-lib"]))).toContain("/work:/work");
  });

  it("adds no extra mount when there are none", () => {
    const withNone = mounts(run(null));
    expect(withNone.filter((m) => m.startsWith("/shared-lib"))).toEqual([]);
    expect(withNone).toContain("/work:/work");
  });

  it("keeps the mount next to the workspace's, before the rest of the run args", () => {
    const args = run(["/a", "/b"]);
    expect(args.indexOf("/a:/a")).toBeGreaterThan(args.indexOf("/work:/work"));
    expect(args.indexOf("/b:/b")).toBeGreaterThan(args.indexOf("/a:/a"));
  });
});

describe("path resolution parity", () => {
  // The CLI flag and the container mount must name the SAME string, or the agent is granted
  // one path and the container exposes another.
  it("hands the same absolute paths to the flag and to the mount", () => {
    const dirs = resolveAddDirs(["../shared-lib"], BASE, exists([SIBLING]));
    expect(dirs).not.toBeNull();
    const args = buildClaudeArgs({
      sessionId: "s1",
      resume: null,
      canResume: false,
      settings: "/cfg/s.json",
      permissionMode: "auto",
      attachGuiMcp: false,
      mcpConfig: "{}",
      allowedTools: "",
      appendedPrompt: null,
      addDirs: dirs,
    });
    const flagged = args.slice(args.indexOf("--add-dir") + 1);
    const mounted = buildDockerRunArgs("s1", args, "/work", "/cfg/c.json", null, dirs).filter((_value, i, all) => all[i - 1] === "-v");
    flagged.forEach((dir) => expect(mounted).toContain(`${dir}:${dir}`));
  });
});
