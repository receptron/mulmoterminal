import { describe, it, expect } from "vitest";

import { messageEffect } from "../../../src/composables/serverMessage";

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

  // A Run command finished vs an agent session ended — only the wording differs.
  it("words the exit banner by whether the slot is a command", () => {
    expect(messageEffect("exit", true).banner).toContain("[finished]");
    expect(messageEffect("exit", false).banner).toContain("[session ended]");
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
