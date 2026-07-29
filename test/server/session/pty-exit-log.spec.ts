import { describe, it, expect } from "vitest";

import { diedDuringStartup, formatLifetime, ptyExitLine, ptyStartLine, STARTUP_WINDOW_MS } from "../../../server/session/pty-exit-log";

describe("ptyStartLine", () => {
  // The distinction #1063 needed and no log carried: `-A` returns a terminal either way, so
  // "spawned" was written for a session whose binary and argv were never used.
  it("says whether tmux attached a running program or started one", () => {
    const common = { agent: "claude", pid: 42, cwd: "/w", tmux: true, sessionId: "s1" };
    expect(ptyStartLine({ ...common, reattached: false })).toContain("started claude (pid=42 via tmux)");
    expect(ptyStartLine({ ...common, reattached: true })).toContain("attached to a running claude (pid=42 via tmux)");
  });

  it("carries the session and the directory", () => {
    const line = ptyStartLine({ agent: "codex", pid: 7, cwd: "/w/repo", tmux: false, reattached: false, sessionId: "abc" });
    expect(line).toBe("[pty] started codex (pid=7) in /w/repo — session abc");
  });

  it("appends a caller's note last", () => {
    const line = ptyStartLine({ agent: "codex", pid: 7, cwd: "/w", tmux: true, reattached: false, sessionId: "abc", note: "resume r1" });
    expect(line).toBe("[pty] started codex (pid=7 via tmux) in /w — session abc — resume r1");
  });

  it("omits the session for a pty that has none", () => {
    expect(ptyStartLine({ agent: "command", pid: 9, cwd: "/w", tmux: false, reattached: false, note: "yarn build" })).toBe(
      "[pty] started command (pid=9) in /w — yarn build",
    );
  });
});

describe("diedDuringStartup", () => {
  it("calls a fast failure a failure to start", () => {
    expect(diedDuringStartup(40, 1)).toBe(true);
  });

  // A command that finishes in milliseconds and finishes CORRECTLY is not a startup failure —
  // the Run terminal is full of them.
  it("never says it of a clean exit, however fast", () => {
    expect(diedDuringStartup(5, 0)).toBe(false);
  });

  it("stops at the window", () => {
    expect(diedDuringStartup(STARTUP_WINDOW_MS - 1, 1)).toBe(true);
    expect(diedDuringStartup(STARTUP_WINDOW_MS, 1)).toBe(false);
  });
});

describe("formatLifetime", () => {
  it("keeps milliseconds under a second, where the exact number is the point", () => {
    expect(formatLifetime(42)).toBe("42ms");
    expect(formatLifetime(999)).toBe("999ms");
  });

  it("switches to seconds, then to minutes", () => {
    expect(formatLifetime(1000)).toBe("1.0s");
    expect(formatLifetime(3400)).toBe("3.4s");
    expect(formatLifetime(60_000)).toBe("1m0s");
    expect(formatLifetime(723_000)).toBe("12m3s");
  });

  // Rounding the minutes and the seconds independently renders this as "1m60s".
  it("carries a rounded-up remainder into the minute", () => {
    expect(formatLifetime(119_999)).toBe("2m0s");
    expect(formatLifetime(59_999)).toBe("60.0s");
  });
});

describe("ptyExitLine", () => {
  it("names a startup failure as one", () => {
    const line = ptyExitLine({ agent: "claude", exitCode: 1, signal: 0, lifetimeMs: 40, cwd: "/w", sessionId: "s1" });
    expect(line).toBe("[pty] claude exited code=1 signal=0 after 40ms — session s1 in /w — it never finished starting");
  });

  it("leaves a long-lived session unlabelled — that one ended, it did not fail", () => {
    const line = ptyExitLine({ agent: "claude", exitCode: 0, signal: 0, lifetimeMs: 723_000, cwd: "/w", sessionId: "s1" });
    expect(line).toBe("[pty] claude exited code=0 signal=0 after 12m3s — session s1 in /w");
  });

  it("omits an absent signal rather than printing undefined", () => {
    expect(ptyExitLine({ agent: "launcher", exitCode: 0, signal: undefined, lifetimeMs: 1500 })).toBe("[pty] launcher exited code=0 after 1.5s");
  });

  it("falls back to the directory when there is no session", () => {
    expect(ptyExitLine({ agent: "command", exitCode: 2, signal: 0, lifetimeMs: 30_000, cwd: "/w" })).toBe(
      "[pty] command exited code=2 signal=0 after 30.0s — /w",
    );
  });
});
