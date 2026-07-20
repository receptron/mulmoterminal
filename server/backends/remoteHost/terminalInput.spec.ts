// @vitest-environment node
import { describe, it, expect } from "vitest";

import { PASTE_END, PASTE_START, sanitizeTerminalInput, sendTerminalInput } from "./terminalInput.js";

// Collects what would have reached the PTY, and runs the delayed Enter on demand
// so the tests never wait on real time.
// ESC and 8-bit CSI are the only two introducers that could turn stripped text back
// into a control sequence, so "no introducer survived" is the property under test.
const hasSequenceIntroducer = (text: string): boolean => text.includes("\u001B") || text.includes("\u009B");

const recorder = (writable = true) => {
  const chunks: string[] = [];
  let submit: (() => void) | null = null;
  return {
    chunks,
    flushSubmit: () => submit?.(),
    deps: {
      writeToSession: (_sessionId: string, chunk: string) => {
        if (!writable) return false;
        chunks.push(chunk);
        return true;
      },
      scheduleSubmit: (fn: () => void) => {
        submit = fn;
      },
    },
  };
};

describe("sanitizeTerminalInput", () => {
  it("keeps ordinary text", () => {
    expect(sanitizeTerminalInput("git status")).toBe("git status");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeTerminalInput("  ls   -la \n")).toBe("ls -la");
  });

  // The text comes from a phone, so it is untrusted. What matters is not that the
  // characters "[201~" disappear but that no ESC (or 8-bit CSI) survives to turn
  // them back into a sequence: without the introducer they are literal text, and the
  // paste cannot be terminated early.
  it("defuses an embedded bracketed-paste terminator", () => {
    const escaped = sanitizeTerminalInput(`ls${PASTE_END}rm -rf /`);
    expect(escaped).not.toContain(PASTE_END);
    expect(hasSequenceIntroducer(escaped)).toBe(false);
  });

  // 8-bit CSI is a single C1 byte, so stripping ESC alone would not be enough.
  it("strips an 8-bit CSI terminator too", () => {
    expect(hasSequenceIntroducer(sanitizeTerminalInput("ls\u009B201~whoami"))).toBe(false);
  });

  it("strips ESC, Ctrl-C and newlines", () => {
    expect(sanitizeTerminalInput("a\x1bb\x03c\r\nd")).toBe("a b c d");
  });

  it("is empty when nothing printable survives", () => {
    expect(sanitizeTerminalInput("\x03\x1b\r\n")).toBe("");
  });
});

describe("sendTerminalInput", () => {
  it("pastes the text, then presses Enter as a separate write", () => {
    const { chunks, flushSubmit, deps } = recorder();
    expect(sendTerminalInput(deps, "s1", "git status")).toEqual({ sent: true });
    // The paste lands immediately; the CR must NOT ride along with it, or Claude's
    // TUI drops it while still committing the paste.
    expect(chunks).toEqual([`${PASTE_START}git status${PASTE_END}`]);
    flushSubmit();
    expect(chunks).toEqual([`${PASTE_START}git status${PASTE_END}`, "\r"]);
  });

  // The property that matters: exactly one paste, closed exactly once at the end.
  it("cannot be made to close the paste early", () => {
    const { chunks, deps } = recorder();
    sendTerminalInput(deps, "s1", `ls${PASTE_END}whoami`);
    const paste = chunks[0];
    expect(paste.startsWith(PASTE_START)).toBe(true);
    expect(paste.endsWith(PASTE_END)).toBe(true);
    expect(paste.split(PASTE_END)).toHaveLength(2);
    expect(hasSequenceIntroducer(paste.slice(PASTE_START.length, -PASTE_END.length))).toBe(false);
  });

  it("refuses text that is empty once sanitized", () => {
    const { chunks, deps } = recorder();
    expect(() => sendTerminalInput(deps, "s1", "\x03\r\n")).toThrow(/text is required/);
    expect(chunks).toEqual([]);
  });

  // A tmux session that outlived a restart is viewable via capture-pane but has no
  // PTY here to type into. Saying so beats a silent no-op the phone reads as success.
  it("reports a session with no live terminal", () => {
    const { deps } = recorder(false);
    expect(() => sendTerminalInput(deps, "ghost", "ls")).toThrow(/no live terminal/);
  });

  it("does not throw when the session ends before the Enter", () => {
    let submit: (() => void) | null = null;
    let alive = true;
    let writes = 0;
    const deps = {
      writeToSession: () => {
        writes += 1;
        return alive;
      },
      scheduleSubmit: (fn: () => void) => {
        submit = fn;
      },
    };
    sendTerminalInput(deps, "s1", "ls");
    alive = false;
    expect(() => submit?.()).not.toThrow();
    // The Enter was still attempted — it just found the pty gone.
    expect(writes).toBe(2);
  });
});
