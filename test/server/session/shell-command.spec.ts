import { describe, it, expect } from "vitest";
import { shellInvocation, launcherAt } from "../../../server/session/shell-command.js";

// platform and SHELL are parameters, so both branches are exercised on every runner —
// otherwise the Windows arm would only ever be checked by the Windows CI job.
describe("shellInvocation", () => {
  describe("posix", () => {
    it("runs the command through the login shell", () => {
      expect(shellInvocation("ls -la", false, "darwin", "/bin/zsh")).toEqual({ shell: "/bin/zsh", args: ["-lc", "ls -la"] });
    });

    it("execs the command when it must become the foreground process", () => {
      // Without exec the launcher's program is a CHILD of the shell, so the pty's
      // foreground process is the shell and the program never owns the terminal.
      expect(shellInvocation("codex", true, "linux", "/bin/zsh")).toEqual({ shell: "/bin/zsh", args: ["-lc", "exec codex"] });
    });

    it("falls back to /bin/bash when SHELL is unset or empty", () => {
      expect(shellInvocation("ls", false, "darwin", undefined).shell).toBe("/bin/bash");
      expect(shellInvocation("ls", false, "darwin", "").shell).toBe("/bin/bash");
    });

    it("keeps the whole command as one argv element", () => {
      // The shell parses it, not execve — so quotes, spaces and operators survive
      // intact rather than being split into separate arguments.
      const { args } = shellInvocation("echo 'a b' && ls | wc -l", false, "linux", "/bin/zsh");
      expect(args).toEqual(["-lc", "echo 'a b' && ls | wc -l"]);
    });
  });

  describe("windows", () => {
    it("runs the command through powershell", () => {
      expect(shellInvocation("dir", false, "win32", undefined)).toEqual({ shell: "powershell.exe", args: ["-NoLogo", "-Command", "dir"] });
    });

    it("ignores SHELL, which is a posix concept", () => {
      expect(shellInvocation("dir", false, "win32", "/bin/zsh").shell).toBe("powershell.exe");
    });

    it("has no exec form — powershell -Command already runs the one command", () => {
      expect(shellInvocation("codex", true, "win32", undefined)).toEqual(shellInvocation("codex", false, "win32", undefined));
    });
  });
});

// The browser sends only an index; the configured list IS the allowlist. Anything that is
// not a real position must resolve to null rather than to undefined, which would spawn a
// launcher with no command.
describe("launcherAt", () => {
  const list = [
    { label: "shell", command: "$SHELL" },
    { label: "codex", command: "codex" },
    { label: "top", command: "top" },
  ];

  it("returns the entry at a valid index", () => {
    expect(launcherAt(list, 1)).toEqual({ label: "codex", command: "codex" });
  });

  it("accepts the first and last positions", () => {
    expect(launcherAt(list, 0)).toBe(list[0]);
    expect(launcherAt(list, 2)).toBe(list[2]);
  });

  it("rejects one past either end", () => {
    expect(launcherAt(list, -1)).toBeNull();
    expect(launcherAt(list, 3)).toBeNull();
  });

  it("rejects a wildly out-of-range index", () => {
    expect(launcherAt(list, 9999)).toBeNull();
    expect(launcherAt(list, -9999)).toBeNull();
  });

  it("rejects a non-integer index", () => {
    expect(launcherAt(list, 1.5)).toBeNull();
    expect(launcherAt(list, NaN)).toBeNull();
    expect(launcherAt(list, Infinity)).toBeNull();
    expect(launcherAt(list, -Infinity)).toBeNull();
  });

  it("resolves nothing when no launcher is configured", () => {
    expect(launcherAt([], 0)).toBeNull();
  });
});
