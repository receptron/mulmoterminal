// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { SessionAgent } from "../../../../server/backends/remoteHost/terminalScreen.js";

import { sanitizeTerminalInput, canClearInputBox } from "../../../../server/backends/remoteHost/terminalInput.js";

// Any byte in these ranges, if it survived, could break out of the bracketed paste and run as
// control input on the host's terminal — the exact thing the sanitizer exists to prevent.
// eslint-disable-next-line no-control-regex -- intentional: assert the sanitizer strips C0/C1 control bytes
const CONTROL_BYTE = /[\u0000-\u001F\u007F-\u009F]/;

describe("sanitizeTerminalInput", () => {
  it("leaves ordinary text alone", () => {
    expect(sanitizeTerminalInput("hello world")).toBe("hello world");
  });

  it("trims and collapses whitespace runs", () => {
    expect(sanitizeTerminalInput("  a    b  ")).toBe("a b");
  });

  // The security cases: each control byte becomes a space, so nothing it introduced can act as
  // a terminal command. \x1b = ESC, \x03 = Ctrl-C, \x7f = DEL, \x85 = a C1 byte.
  it.each([
    ["a\x1bb", "a b"],
    ["a\x03b", "a b"],
    ["a\x7fb", "a b"],
    ["a\x85b", "a b"],
    ["line1\nline2", "line1 line2"],
    ["a\r\nb", "a b"],
    ["a\tb", "a b"],
  ])("replaces the control byte in %j with a space", (raw, expected) => {
    expect(sanitizeTerminalInput(raw)).toBe(expected);
  });

  // A bracketed-paste terminator is ESC + "[201~"; stripping the ESC is what defuses it — the
  // leftover "[201~" is inert printable text, and crucially no ESC remains to start a sequence.
  it("defuses an embedded bracketed-paste terminator", () => {
    const out = sanitizeTerminalInput("safe\x1b[201~evil");
    expect(out).toBe("safe [201~evil");
    expect(CONTROL_BYTE.test(out)).toBe(false);
  });

  it("collapses a run of adjacent control bytes to a single space", () => {
    expect(sanitizeTerminalInput("a\x1b\x03\r\nb")).toBe("a b");
  });

  it.each(["", "   ", "\x1b\x03\r\n", "\t\t"])("is empty for input with no printable content (%j)", (raw) => {
    expect(sanitizeTerminalInput(raw)).toBe("");
  });

  it("keeps printable non-ASCII (accents, emoji are not control bytes)", () => {
    expect(sanitizeTerminalInput("café 😀")).toBe("café 😀");
  });

  // The invariant that matters: whatever comes in, no control byte comes out.
  it.each(["plain", "a\x1b[201~b", "\x00\x01\x02mixed\x1b\x7f", "emoji 😀 and\ttabs", "edge"])("never lets a control byte through (%j)", (raw) => {
    expect(CONTROL_BYTE.test(sanitizeTerminalInput(raw))).toBe(false);
  });
});

describe("canClearInputBox", () => {
  // The one and only case that clears the box: a Claude the host has watched finish a turn.
  it("allows clearing a Claude whose turn is known to be over", () => {
    expect(canClearInputBox("claude", false)).toBe(true);
  });

  // Mid-turn Ctrl-C would interrupt the running turn.
  it("refuses while a Claude turn is in progress", () => {
    expect(canClearInputBox("claude", true)).toBe(false);
  });

  // The deliberate asymmetry the code pins with `working === false`, not `working !== true`:
  // a missing activity record means "nobody has reported yet", which covers a live first turn —
  // NOT idle. Reading undefined as idle would interrupt that turn.
  it("refuses a Claude whose turn state is unknown", () => {
    expect(canClearInputBox("claude", undefined)).toBe(false);
  });

  // Codex is excluded even when reported idle: nothing calls setWorking for codex, so `working`
  // is never authoritative there. Shell is excluded because Ctrl-C kills whatever is running.
  it.each<[SessionAgent, boolean | undefined]>([
    ["codex", false],
    ["codex", true],
    ["codex", undefined],
    ["shell", false],
    ["shell", true],
    ["shell", undefined],
  ])("refuses a non-Claude agent (%j, working=%j)", (agent, working) => {
    expect(canClearInputBox(agent, working)).toBe(false);
  });

  it.each<[null | undefined, boolean | undefined]>([
    [null, false],
    [undefined, false],
    [null, undefined],
  ])("refuses when the agent is unknown (%j, working=%j)", (agent, working) => {
    expect(canClearInputBox(agent, working)).toBe(false);
  });
});
