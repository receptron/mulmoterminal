import { describe, it, expect } from "vitest";

import { binaryProblemMessage, diagnoseBinary, hasBinary, type BinaryProbe } from "../../../server/infra/has-binary";

// A fake filesystem: files that exist, and which of those this process may execute. Injected so
// the Windows rules are checkable from a POSIX host (and the POSIX ones from Windows CI).
const probeOf = (files: Record<string, "x" | "r">): BinaryProbe => ({
  isFile: (candidate) => candidate in files,
  isExecutable: (candidate) => files[candidate] === "x",
});

const posixEnv = (...dirs: string[]) => ({ PATH: dirs.join(":") });

describe("diagnoseBinary on POSIX", () => {
  it("finds an executable file on PATH", () => {
    const probe = probeOf({ "/opt/bin/codex": "x" });
    expect(diagnoseBinary("codex", posixEnv("/usr/bin", "/opt/bin"), "darwin", probe)).toEqual({ kind: "ok", path: "/opt/bin/codex" });
  });

  // The reported bug's real shape: installed, and `which codex` works in the user's shell, but
  // the directory holding it is not on the PATH the server spawns with.
  it("reports the directories it searched when nothing is found", () => {
    const probe = probeOf({ "/home/me/.nodebrew/current/bin/codex": "x" });
    expect(diagnoseBinary("codex", posixEnv("/usr/bin", "/bin"), "darwin", probe)).toEqual({ kind: "missing", searched: ["/usr/bin", "/bin"] });
  });

  it("separates a file that cannot be run from one that is not there", () => {
    const probe = probeOf({ "/opt/bin/codex": "r" });
    expect(diagnoseBinary("codex", posixEnv("/opt/bin"), "darwin", probe)).toEqual({ kind: "not-executable", path: "/opt/bin/codex" });
  });

  // execvp's rule, and the one a naive "first match wins" gets wrong: a stray non-executable
  // earlier on PATH does not shadow the real install later on it.
  it("prefers a later runnable entry over an earlier unrunnable one", () => {
    const probe = probeOf({ "/a/codex": "r", "/b/codex": "x" });
    expect(diagnoseBinary("codex", posixEnv("/a", "/b"), "darwin", probe)).toEqual({ kind: "ok", path: "/b/codex" });
  });

  // THE rule this verdict now has to obey: it refuses the spawn, so it must never be stricter
  // than execvp. Every case below is one execvp could still launch, and none may say missing.
  //
  // An entry that is not absolute is resolved by execvp against the CHILD's working directory —
  // the PTY's, which this process cannot look in. A zero-length prefix is POSIX's spelling of
  // exactly that (Codex), and a plainly relative entry is the same thing spelled out (CodeRabbit).
  // Measured: with `PATH=tools` and the binary in the pty cwd's `tools/`, the spawn succeeds.
  it.each([[":/usr/bin"], ["/usr/bin:"], ["/a::/b"], [""], ["tools"], ["."], ["../bin"], ["/usr/bin:tools"]])(
    "refuses nothing when PATH has a non-absolute entry (%j)",
    (PATH) => {
      expect(diagnoseBinary("codex", { PATH }, "darwin", probeOf({}))).toEqual({ kind: "ok", path: "codex" });
    },
  );

  // An UNSET PATH is not an empty one: execvp falls back to a built-in default this process
  // cannot enumerate.
  it("refuses nothing when PATH is unset", () => {
    expect(diagnoseBinary("codex", {}, "darwin", probeOf({}))).toEqual({ kind: "ok", path: "codex" });
  });

  // The empty entry must not be able to mask a real answer either way round: a runnable binary
  // still resolves to its path, and an unrunnable one is not reported when the cwd could hold one.
  it("keeps a real hit, and withholds not-executable, when an empty entry is present", () => {
    expect(diagnoseBinary("codex", { PATH: "/a::/b" }, "darwin", probeOf({ "/b/codex": "x" }))).toEqual({ kind: "ok", path: "/b/codex" });
    expect(diagnoseBinary("codex", { PATH: "/a:" }, "darwin", probeOf({ "/a/codex": "r" }))).toEqual({ kind: "ok", path: "codex" });
    expect(diagnoseBinary("codex", { PATH: "tools:/b" }, "darwin", probeOf({ "/b/codex": "x" }))).toEqual({ kind: "ok", path: "/b/codex" });
  });

  it("answers missing for an empty name rather than searching for it", () => {
    expect(diagnoseBinary("", posixEnv("/usr/bin"), "darwin", probeOf({ "/usr/bin/": "x" }))).toEqual({ kind: "missing", searched: [] });
  });

  // CODEX_BIN=/full/path — checked as given, never looked up on PATH. A path that isn't there is
  // its OWN verdict, not a PATH miss: the advice for the two is opposite (Codex, #1068).
  it("checks an absolute path as given", () => {
    const probe = probeOf({ "/opt/codex": "x", "/opt/broken": "r" });
    expect(diagnoseBinary("/opt/codex", posixEnv("/usr/bin"), "darwin", probe)).toEqual({ kind: "ok", path: "/opt/codex" });
    expect(diagnoseBinary("/opt/broken", posixEnv("/usr/bin"), "darwin", probe)).toEqual({ kind: "not-executable", path: "/opt/broken" });
    expect(diagnoseBinary("/opt/absent", posixEnv("/usr/bin"), "darwin", probe)).toEqual({ kind: "no-such-path", path: "/opt/absent" });
    // A directory at the override path is equally unstartable, and equally not a PATH miss.
    expect(diagnoseBinary("/opt", posixEnv("/usr/bin"), "darwin", probe)).toEqual({ kind: "no-such-path", path: "/opt" });
  });

  // A relative path resolves against the PTY's cwd, not ours, so this cannot answer it and must
  // not refuse the spawn on a guess.
  it("passes a relative path through untested", () => {
    expect(diagnoseBinary("./bin/codex", posixEnv("/usr/bin"), "darwin", probeOf({}))).toEqual({ kind: "ok", path: "./bin/codex" });
  });
});

describe("diagnoseBinary on Windows", () => {
  const winEnv = (...dirs: string[]) => ({ Path: dirs.join(";") });

  it("appends the executable extension a bare name omits", () => {
    const probe = probeOf({ "C:\\tools\\codex.exe": "x" });
    expect(diagnoseBinary("codex", winEnv("C:\\tools"), "win32", probe)).toEqual({ kind: "ok", path: "C:\\tools\\codex.exe" });
  });

  it("accepts a batch shim when no executable resolves", () => {
    const probe = probeOf({ "C:\\npm\\codex.cmd": "x" });
    expect(diagnoseBinary("codex", winEnv("C:\\npm"), "win32", probe)).toEqual({ kind: "ok", path: "C:\\npm\\codex.cmd" });
  });

  // There is no execute BIT on Windows — what runs is decided by file type, which resolve-bin
  // already encodes. Inventing a not-executable verdict here would refuse spawns that work.
  it("never reports not-executable, only missing", () => {
    const probe = probeOf({ "C:\\tools\\codex.exe": "r" });
    expect(diagnoseBinary("codex", winEnv("C:\\tools"), "win32", probe)).toEqual({ kind: "ok", path: "C:\\tools\\codex.exe" });
    expect(diagnoseBinary("codex", winEnv("C:\\other"), "win32", probe)).toEqual({ kind: "missing", searched: ["C:\\other"] });
  });

  // node-pty's own lookup compares file names EXACTLY, so an extension-less image on PATH is one
  // it can still run. resolve-bin hands it the bare name in that case rather than resolving, and
  // refusing it here would break a host that spawns fine today.
  it("accepts an extension-less name node-pty would still find", () => {
    const probe = probeOf({ "C:\\tools\\codex": "x" });
    expect(diagnoseBinary("codex", winEnv("C:\\tools"), "win32", probe)).toEqual({ kind: "ok", path: "C:\\tools\\codex" });
  });

  // CODEX_BIN=C:\… goes down the same branch as the POSIX override but with the OTHER path rules,
  // and a drive-letter path is only recognised as absolute by path.win32 (CodeRabbit).
  it("checks a drive-letter override path as given", () => {
    const probe = probeOf({ "C:\\tools\\codex.exe": "x" });
    expect(diagnoseBinary("C:\\tools\\codex.exe", winEnv("C:\\other"), "win32", probe)).toEqual({ kind: "ok", path: "C:\\tools\\codex.exe" });
    expect(diagnoseBinary("C:\\gone\\codex.exe", winEnv("C:\\other"), "win32", probe)).toEqual({ kind: "no-such-path", path: "C:\\gone\\codex.exe" });
  });

  // The Windows rules must be answerable from a POSIX host and the POSIX rules from Windows, or
  // neither can be tested where it matters — hence path.win32 / path.posix rather than the host's.
  it("splits PATH on ';' and joins with '\\' regardless of the host", () => {
    const probe = probeOf({ "C:\\b\\codex.exe": "x" });
    expect(diagnoseBinary("codex", winEnv("C:\\a", "C:\\b"), "win32", probe)).toEqual({ kind: "ok", path: "C:\\b\\codex.exe" });
    expect(diagnoseBinary("codex", { PATH: "/a:/b" }, "darwin", probeOf({ "/b/codex": "x" }))).toEqual({ kind: "ok", path: "/b/codex" });
  });
});

describe("hasBinary", () => {
  // A file that is merely PRESENT used to answer yes here. The rate-limit probe (#1011) uses
  // this to decide whether spawning is worth attempting, and a claude it cannot execute is not.
  it("answers yes only for something that can actually be run", () => {
    const probe = probeOf({ "/opt/bin/claude": "x", "/opt/bin/broken": "r" });
    const env = posixEnv("/opt/bin");
    expect(hasBinary("claude", env, "darwin", probe)).toBe(true);
    expect(hasBinary("broken", env, "darwin", probe)).toBe(false);
    expect(hasBinary("absent", env, "darwin", probe)).toBe(false);
    expect(hasBinary("", env, "darwin", probe)).toBe(false);
  });
});

describe("binaryProblemMessage", () => {
  it("says nothing when the binary is fine", () => {
    expect(binaryProblemMessage("codex", { kind: "ok", path: "/opt/bin/codex" }, "CODEX_BIN")).toBeNull();
  });

  // The message has to carry BOTH halves of the surprise: which PATH was searched (not the
  // login shell's), and the override that fixes it without touching the shell.
  it("names the searched PATH and the override for a missing binary", () => {
    const message = binaryProblemMessage("codex", { kind: "missing", searched: ["/usr/bin", "/bin"] }, "CODEX_BIN") ?? "";
    expect(message).toContain("/usr/bin");
    expect(message).toContain("CODEX_BIN");
    expect(message).toContain("which codex");
  });

  it("truncates a long PATH instead of pasting all of it into the terminal", () => {
    const searched = ["/a", "/b", "/c", "/d", "/e", "/f"];
    const message = binaryProblemMessage("codex", { kind: "missing", searched }, "CODEX_BIN") ?? "";
    expect(message).toContain("+2 more");
    expect(message).not.toContain("/f");
  });

  // Someone reading this has ALREADY set the override, so the PATH advice is not just useless,
  // it tells them to do the thing that put them here — and "`/opt/absent` is not on the PATH …
  // set CODEX_BIN to its full path" contradicts itself.
  it("does not give PATH advice for an override that points nowhere", () => {
    const message = binaryProblemMessage("/opt/absent", { kind: "no-such-path", path: "/opt/absent" }, "CODEX_BIN") ?? "";
    expect(message).toContain("/opt/absent");
    expect(message).toContain("CODEX_BIN");
    expect(message).not.toContain("not on the PATH");
    expect(message).not.toContain("which /opt/absent");
  });

  it("points at the file itself when it is there but cannot run", () => {
    const message = binaryProblemMessage("codex", { kind: "not-executable", path: "/opt/bin/codex" }, "CODEX_BIN") ?? "";
    expect(message).toContain("found at /opt/bin/codex");
    expect(message).toContain("not an executable file");
  });

  // With CODEX_BIN set to a full path, the name and the path are the same string — saying both
  // reads as two different files.
  it("does not repeat the path when the name already is one", () => {
    const message = binaryProblemMessage("/opt/bin/codex", { kind: "not-executable", path: "/opt/bin/codex" }, "CODEX_BIN") ?? "";
    expect(message).not.toContain("found at");
    expect(message.match(/\/opt\/bin\/codex/g)).toHaveLength(1);
  });
});
