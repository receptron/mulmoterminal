import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveAddDirs, MAX_ADD_DIRS } from "../../../server/config/config-schema";
import { buildClaudeArgs } from "../../../server/agents/claude-args";

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

// #938 rides on this same list: a pasted screenshot is saved outside the working directory,
// and Claude Code asks permission to read outside it. A file dropped OR pasted into a session is
// saved outside its cwd, and the agent is granted that directory through the same channel a
// user's own `addDirs` travels.
describe("the session's drop directory shares the addDirs channel", () => {
  const DROPS = path.resolve("/drops/s1");
  // How spawn-claude composes it: the user's resolved list, then the app's own entry.
  const withDropsDir = (configured: string[]) => [...configured, DROPS];

  it("reaches the flag alongside what the user configured", () => {
    const dirs = withDropsDir(resolveAddDirs([DOCS], BASE, exists([DOCS])) ?? []);
    expect(dirs).toEqual([DOCS, DROPS]);
    const args = buildClaudeArgs({
      sessionId: "s1",
      resume: null,
      canResume: false,
      settings: "/cfg/s.json",
      permissionMode: "auto",
      attachGuiMcp: false,
      mcpConfig: "{}",
      allowedTools: "",
      addDirs: dirs,
      appendedPrompt: null,
    });
    expect(args.slice(args.indexOf("--add-dir") + 1)).toEqual([DOCS, DROPS]);
  });

  // MAX_ADD_DIRS caps what a user may ask for; the app's own entry is added after that cap
  // and must not be the one that falls off.
  it("survives a config that already filled MAX_ADD_DIRS", () => {
    const configured = Array.from({ length: MAX_ADD_DIRS }, (_unused, i) => path.resolve(`/d${i}`));
    const dirs = withDropsDir(resolveAddDirs(configured, BASE, exists(configured)) ?? []);
    expect(dirs).toHaveLength(MAX_ADD_DIRS + 1);
    expect(dirs[dirs.length - 1]).toBe(DROPS);
  });
});
