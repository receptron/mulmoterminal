import { describe, it, expect } from "vitest";

import { copyModeOf, exitCodeOf, messageEffect, sessionExitOf } from "../../../src/composables/serverMessage";

describe("messageEffect", () => {
  // An unknown or non-terminal type must not stop the connection — output/session are handled
  // elsewhere, and a stray type must not be mistaken for a terminal one.
  it.each([["output"], ["session"], [undefined], ["heartbeat"], [""]])("is non-terminal for %j", (type) => {
    expect(messageEffect(type, false)).toEqual({ terminal: false, callsOnExit: false, banner: null });
  });

  it("treats exit as terminal and fires onExit", () => {
    const e = messageEffect("exit", false);
    expect([e.terminal, e.callsOnExit]).toEqual([true, true]);
  });

  // The client's 0 is all there is, so the banner must not read as a clean end.
  it("says an unrecorded exit was not recorded, in red, whatever the code", () => {
    const banner = messageEffect("exit", false, undefined, 0, true).banner ?? "";
    expect(banner).toContain("how it ended was not recorded");
    expect(banner).toContain("\x1b[31m");
    expect(messageEffect("exit", false, undefined, 0).banner).not.toContain("not recorded");
  });

  // A Run command finished vs an agent session ended — only the wording differs.
  it("words the exit banner by whether the slot is a command", () => {
    expect(messageEffect("exit", true).banner).toContain("[finished]");
    expect(messageEffect("exit", false).banner).toContain("[session ended]");
    expect(messageEffect("exit", true, undefined, 0).banner).toContain("[finished]");
    expect(messageEffect("exit", false, undefined, 0).banner).toContain("[session ended]");
  });

  // A binary that could not run leaves NO other trace — no output, and under tmux the pane's
  // own error is wiped by the alt-screen restore. The status is the only evidence there is, so
  // a non-zero one must reach the screen instead of reading as a clean finish (#1063).
  it("names a non-zero exit status in the banner", () => {
    expect(messageEffect("exit", false, undefined, 1).banner).toContain("exit 1");
    expect(messageEffect("exit", true, undefined, 127).banner).toContain("exit 127");
  });

  // Red for a failure, the same colour the error banner uses; green stays the clean-exit signal.
  it("colours a non-zero exit like an error and a clean one like a success", () => {
    const RED = "\x1b[31m";
    const GREEN = "\x1b[33m";
    expect(messageEffect("exit", false, undefined, 1).banner).toContain(RED);
    expect(messageEffect("exit", false, undefined, 0).banner).toContain(GREEN);
    // No status reported at all is not a failure — it is a server that named none.
    expect(messageEffect("exit", false, undefined, null).banner).toContain(GREEN);
  });

  // THE decision this file exists for: superseded is terminal (don't reconnect — the two tabs
  // would evict each other forever) but must NOT fire onExit — the session is alive elsewhere,
  // so offering a re-run is wrong.
  it("stops on superseded WITHOUT firing onExit", () => {
    const e = messageEffect("superseded", false);
    expect([e.terminal, e.callsOnExit]).toEqual([true, false]);
    expect(e.banner).toContain("another window");
  });

  it("treats error as terminal and fires onExit", () => {
    const e = messageEffect("error", false, "claude not found");
    expect([e.terminal, e.callsOnExit]).toEqual([true, true]);
    expect(e.banner).toContain("claude not found");
  });

  // A non-string message (or none) must not paste "undefined" into the terminal.
  it.each([[undefined], [null], [42], [{}]])("falls back to a stable error banner for message %j", (message) => {
    expect(messageEffect("error", false, message).banner).toContain("failed to start");
  });

  it("uses the command wording only for exit, not for error", () => {
    // error is the same regardless of isCommand — the branch is exit-only.
    expect(messageEffect("error", true, "x").banner).toBe(messageEffect("error", false, "x").banner);
  });
});

describe("exitCodeOf", () => {
  it("reads the status the server reported", () => {
    expect(exitCodeOf({ exitCode: 0 })).toBe(0);
    expect(exitCodeOf({ exitCode: 137 })).toBe(137);
  });

  // A start failure names no code, and a Run cell must not read that as a clean finish.
  it("answers null when there is no usable status", () => {
    expect(exitCodeOf({})).toBeNull();
    expect(exitCodeOf({ exitCode: undefined })).toBeNull();
    expect(exitCodeOf({ exitCode: null })).toBeNull();
    expect(exitCodeOf({ exitCode: "0" })).toBeNull();
  });
});

describe("copyModeOf", () => {
  it("reads the flag off a paneMode frame", () => {
    expect(copyModeOf({ type: "paneMode", inCopyMode: true })).toBe(true);
    expect(copyModeOf({ type: "paneMode", inCopyMode: false })).toBe(false);
  });

  // Null leaves the banner as it was; false would take it down while keys are still being eaten.
  it("returns null for a malformed paneMode frame", () => {
    [undefined, null, 1, 0, "true", "false", {}].forEach((inCopyMode) => expect(copyModeOf({ type: "paneMode", inCopyMode })).toBeNull());
    expect(copyModeOf({ type: "paneMode" })).toBeNull();
  });

  it("returns null for any other frame, even one carrying the field", () => {
    expect(copyModeOf({ type: "output", inCopyMode: true })).toBeNull();
    expect(copyModeOf({ inCopyMode: true })).toBeNull();
  });
});

describe("sessionExitOf", () => {
  it("reads a reaped session and its lifetime", () => {
    expect(sessionExitOf({ ended: true, lifetimeMs: 5000, reattached: true })).toEqual({
      sessionEnded: true,
      lifetimeMs: 5000,
      reattached: true,
      exitUnrecorded: false,
      closedOnRequest: false,
    });
    expect(sessionExitOf({ ended: false, lifetimeMs: 0, reattached: false })).toEqual({
      sessionEnded: false,
      lifetimeMs: 0,
      reattached: false,
      exitUnrecorded: false,
      closedOnRequest: false,
    });
  });

  // #3446: only a literal true may close a worktree cell the server did not mean to close.
  it("reads a close the server asked for only from a literal true", () => {
    expect(sessionExitOf({ ended: true, closedOnRequest: true }).closedOnRequest).toBe(true);
    [{}, { closedOnRequest: "true" }, { closedOnRequest: 1 }, { closedOnRequest: null }].forEach((frame) =>
      expect(sessionExitOf(frame).closedOnRequest, JSON.stringify(frame)).toBe(false),
    );
  });

  it("reads an unrecorded exit only from a literal true", () => {
    expect(sessionExitOf({ exitUnrecorded: true }).exitUnrecorded).toBe(true);
    expect(sessionExitOf({ exitUnrecorded: "true" }).exitUnrecorded).toBe(false);
    expect(sessionExitOf({}).exitUnrecorded).toBe(false);
  });

  // Anything but a literal true must not close a cell: a frame from an older server has no field.
  it.each([[{}], [{ ended: "true" }], [{ ended: 1 }], [{ ended: null }]])("is not ended for %j", (frame) => {
    expect(sessionExitOf(frame).sessionEnded).toBe(false);
  });

  it.each([[{}], [{ reattached: "true" }], [{ reattached: 1 }]])("is not reattached for %j", (frame) => {
    expect(sessionExitOf(frame).reattached).toBe(false);
  });

  it.each([[{}], [{ lifetimeMs: "5000" }], [{ lifetimeMs: Number.NaN }], [{ lifetimeMs: Number.POSITIVE_INFINITY }], [{ lifetimeMs: null }]])(
    "has no lifetime for %j",
    (frame) => {
      expect(sessionExitOf(frame).lifetimeMs).toBeNull();
    },
  );
});
