// @vitest-environment node
import { describe, it, expect } from "vitest";

import { CLEAR_BOX, PASTE_END, PASTE_START, canClearInputBox, createTerminalInputSender, sanitizeTerminalInput } from "./terminalInput.js";

// Collects what would have reached the PTY, and runs the delayed Enter on demand
// so the tests never wait on real time.
// ESC and 8-bit CSI are the only two introducers that could turn stripped text back
// into a control sequence, so "no introducer survived" is the property under test.
const hasSequenceIntroducer = (text: string): boolean => text.includes("\u001B") || text.includes("\u009B");

// Chaining moved the first write behind a microtask, so tests must let the queue
// run before asserting on what reached the PTY.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const recorder = (writable = true, canClearBox?: (sessionId: string) => boolean) => {
  const chunks: string[] = [];
  const submits: Array<() => void> = [];
  const deps = {
    writeToSession: (_sessionId: string, chunk: string) => {
      if (!writable) return false;
      chunks.push(chunk);
      return true;
    },
    canClearBox,
    // Queue the Enters instead of timing them, so a test decides when each lands.
    scheduleSubmit: (fn: () => void) => {
      submits.push(fn);
    },
  };
  return { chunks, submits, flushSubmit: () => submits.shift()?.(), send: createTerminalInputSender(deps) };
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
  it("pastes the text, then presses Enter as a separate write", async () => {
    const { chunks, flushSubmit, send } = recorder();
    const sent = send("s1", "git status");
    await tick();
    // The paste lands immediately; the CR must NOT ride along with it, or Claude's
    // TUI drops it while still committing the paste.
    expect(chunks).toEqual([`${PASTE_START}git status${PASTE_END}`]);
    flushSubmit();
    await expect(sent).resolves.toEqual({ sent: true });
    expect(chunks).toEqual([`${PASTE_START}git status${PASTE_END}`, "\r"]);
  });

  // The property that matters: exactly one paste, closed exactly once at the end.
  it("cannot be made to close the paste early", async () => {
    const { chunks, send } = recorder();
    void send("s1", `ls${PASTE_END}whoami`);
    await tick();
    const paste = chunks[0];
    expect(paste.startsWith(PASTE_START)).toBe(true);
    expect(paste.endsWith(PASTE_END)).toBe(true);
    expect(paste.split(PASTE_END)).toHaveLength(2);
    expect(hasSequenceIntroducer(paste.slice(PASTE_START.length, -PASTE_END.length))).toBe(false);
  });

  it("refuses text that is empty once sanitized", async () => {
    const { chunks, send } = recorder();
    await expect(send("s1", "\x03\r\n")).rejects.toThrow(/text is required/);
    expect(chunks).toEqual([]);
  });

  // A tmux session that outlived a restart is viewable via capture-pane but has no
  // PTY here to type into. Saying so beats a silent no-op the phone reads as success.
  it("reports a session with no live terminal", async () => {
    const { send } = recorder(false);
    await expect(send("ghost", "ls")).rejects.toThrow(/no live terminal/);
  });

  it("does not throw when the session ends before the Enter", async () => {
    let submit: (() => void) | null = null;
    let alive = true;
    let writes = 0;
    const send = createTerminalInputSender({
      writeToSession: () => {
        writes += 1;
        return alive;
      },
      scheduleSubmit: (fn: () => void) => {
        submit = fn;
      },
    });
    const sent = send("s1", "ls");
    await tick();
    alive = false;
    expect(() => submit?.()).not.toThrow();
    await expect(sent).resolves.toEqual({ sent: true });
    // The Enter was still attempted — it just found the pty gone.
    expect(writes).toBe(2);
  });

  // Two sends that overlap would otherwise interleave as paste-A, paste-B, CR, CR:
  // the terminal runs the two commands merged onto one line, then submits an empty
  // one. Each session's sends are chained so the next paste waits for the previous
  // Enter.
  it("serializes overlapping sends on one session", async () => {
    const { chunks, flushSubmit, send } = recorder();
    const first = send("s1", "one");
    const second = send("s1", "two");
    await tick();
    // The second paste must not have gone out while the first is unsubmitted.
    expect(chunks).toEqual([`${PASTE_START}one${PASTE_END}`]);
    flushSubmit();
    await first;
    await tick();
    expect(chunks).toEqual([`${PASTE_START}one${PASTE_END}`, "\r", `${PASTE_START}two${PASTE_END}`]);
    flushSubmit();
    await second;
    expect(chunks).toEqual([`${PASTE_START}one${PASTE_END}`, "\r", `${PASTE_START}two${PASTE_END}`, "\r"]);
  });

  it("does not make one session wait on another", async () => {
    const { chunks, flushSubmit, send } = recorder();
    const a = send("s1", "one");
    const b = send("s2", "two");
    await tick();
    // Different sessions are independent, so both pastes go out immediately.
    expect(chunks).toEqual([`${PASTE_START}one${PASTE_END}`, `${PASTE_START}two${PASTE_END}`]);
    flushSubmit();
    flushSubmit();
    await Promise.all([a, b]);
  });

  // A rejected send must not wedge the session's chain for every later one.
  it("keeps the chain alive after a failed send", async () => {
    const { chunks, flushSubmit, send } = recorder();
    await expect(send("s1", "\x03")).rejects.toThrow(/text is required/);
    const after = send("s1", "ls");
    await tick();
    flushSubmit();
    await expect(after).resolves.toEqual({ sent: true });
    expect(chunks).toEqual([`${PASTE_START}ls${PASTE_END}`, "\r"]);
  });
});

// Ctrl-C is destructive wherever the host cannot vouch for the session's state, so the
// rule that decides is deliberately narrow — and narrow in a way that is easy to widen
// by accident, which is what these lock down.
describe("canClearInputBox", () => {
  it("allows it for a Claude the host has seen finish a turn", () => {
    expect(canClearInputBox("claude", false)).toBe(true);
  });

  // A missing activity record is "nobody has reported yet", NOT "idle". A session
  // spawned with an initialPrompt runs its first turn before any hook fires, and
  // setWorking(id, false) does not even create a record — so reading unknown as idle
  // would interrupt that turn.
  it("refuses when no activity has been reported for the session", () => {
    expect(canClearInputBox("claude", undefined)).toBe(false);
  });

  // Ctrl-C mid-turn interrupts the turn. Whatever is in the box then is a QUEUED
  // prompt, so the old merge behaviour is the lesser evil against discarding it.
  it("refuses while Claude is mid-turn", () => {
    expect(canClearInputBox("claude", true)).toBe(false);
  });

  // Nothing calls setWorking for codex, so `working` is false even mid-turn and the
  // idle answer would be a guess — not a fact.
  it("refuses for codex, whose turn state the host does not track", () => {
    expect(canClearInputBox("codex", false)).toBe(false);
    expect(canClearInputBox("codex", undefined)).toBe(false);
  });

  it("refuses for a shell even once it has reported idle", () => {
    expect(canClearInputBox("shell", false)).toBe(false);
  });

  it("refuses when the host cannot say what is running", () => {
    expect(canClearInputBox(null, false)).toBe(false);
    expect(canClearInputBox(undefined, false)).toBe(false);
  });
});

// #572: a draft left in the box on the host used to be submitted merged with the
// phone's text ("yes I already typed this" + "ok" → "yes I already typedthisok").
describe("clearing the host's input box", () => {
  it("empties the box in the same write as the paste, so only the phone's text is left", async () => {
    const { chunks, flushSubmit, send } = recorder(true, () => true);
    const sent = send("s1", "ok");
    await tick();
    // ONE write: measured against a live TUI, the clear needs no delay of its own —
    // unlike the Enter, which still follows separately.
    expect(chunks).toEqual([`${CLEAR_BOX}${PASTE_START}ok${PASTE_END}`]);
    flushSubmit();
    await expect(sent).resolves.toEqual({ sent: true });
    expect(chunks).toEqual([`${CLEAR_BOX}${PASTE_START}ok${PASTE_END}`, "\r"]);
  });

  // Ctrl-C mid-turn interrupts the turn, and in a shell it kills whatever is running,
  // so the host withholds permission for everything it cannot vouch for.
  it("leaves the box alone when the host says it is not safe", async () => {
    const { chunks, send } = recorder(true, () => false);
    void send("s1", "ok");
    await tick();
    expect(chunks).toEqual([`${PASTE_START}ok${PASTE_END}`]);
  });

  // The old callers pass no such dep at all; they must keep the old behaviour.
  it("leaves the box alone when no host answer is wired at all", async () => {
    const { chunks, send } = recorder();
    void send("s1", "ok");
    await tick();
    expect(chunks[0]).not.toContain(CLEAR_BOX);
  });

  it("asks per session, not once for the host", async () => {
    const asked: string[] = [];
    const { chunks, send } = recorder(true, (sessionId) => {
      asked.push(sessionId);
      return sessionId === "idle-claude";
    });
    void send("idle-claude", "ok");
    void send("busy-one", "ok");
    await tick();
    expect(asked).toEqual(["idle-claude", "busy-one"]);
    expect(chunks).toEqual([`${CLEAR_BOX}${PASTE_START}ok${PASTE_END}`, `${PASTE_START}ok${PASTE_END}`]);
  });

  // The clear is ours to send; the phone must never be able to smuggle its own in and
  // wipe a draft on a session the host declined to clear.
  it("sends exactly the one clear it decided on, whatever the phone typed", async () => {
    const { chunks, send } = recorder(true, () => true);
    void send("s1", `ok${CLEAR_BOX}and more`);
    await tick();
    expect(chunks[0].split(CLEAR_BOX)).toHaveLength(2);
    expect(chunks[0].startsWith(CLEAR_BOX)).toBe(true);
  });
});
