import { describe, it, expect } from "vitest";

import { cwdProblemMessage, diagnoseSpawnCwd, fsCwdProbe, type CwdKind, type CwdProbe } from "../../../server/infra/spawn-cwd";

const probeOf =
  (answers: Record<string, CwdKind>): CwdProbe =>
  (dir) =>
    answers[dir] ?? "missing";

describe("diagnoseSpawnCwd", () => {
  it("accepts a directory", () => {
    expect(diagnoseSpawnCwd("/home/me/project", probeOf({ "/home/me/project": "directory" }))).toEqual({ kind: "ok" });
  });

  // The reported shape: a project directory (or a pruned git worktree) that is simply gone. On
  // macOS this reaches the user as an exit code and a blank pane, never as an error.
  it("reports a directory that is not there", () => {
    expect(diagnoseSpawnCwd("/home/me/deleted", probeOf({}))).toEqual({ kind: "missing" });
  });

  it("separates a file from a missing path", () => {
    expect(diagnoseSpawnCwd("/home/me/notes.md", probeOf({ "/home/me/notes.md": "file" }))).toEqual({ kind: "not-a-directory" });
  });

  // The rule has-binary.ts states, and the one that keeps this from breaking working setups: a
  // pre-flight that cannot answer must never be the thing that refuses the spawn.
  it("passes a path it could not stat", () => {
    expect(diagnoseSpawnCwd("/mnt/unreachable", probeOf({ "/mnt/unreachable": "unknown" }))).toEqual({ kind: "ok" });
  });

  it("passes an empty cwd, which node-pty resolves to our own", () => {
    expect(diagnoseSpawnCwd("", probeOf({}))).toEqual({ kind: "ok" });
  });
});

describe("fsCwdProbe", () => {
  it("answers for real paths", () => {
    expect(fsCwdProbe(process.cwd())).toBe("directory");
    expect(fsCwdProbe(`${process.cwd()}/package.json`)).toBe("file");
    expect(fsCwdProbe(`${process.cwd()}/no-such-entry-here`)).toBe("missing");
  });
});

describe("cwdProblemMessage", () => {
  it("says nothing when the directory is usable", () => {
    expect(cwdProblemMessage("/home/me/project", { kind: "ok" })).toBeNull();
  });

  it("names the directory, since that is the whole finding", () => {
    const message = cwdProblemMessage("/home/me/deleted", { kind: "missing" });
    expect(message).toContain("/home/me/deleted");
    expect(message).toContain("no longer exists");
  });

  it("distinguishes a file from a deleted directory", () => {
    expect(cwdProblemMessage("/home/me/notes.md", { kind: "not-a-directory" })).toContain("is a file, not a directory");
  });
});
