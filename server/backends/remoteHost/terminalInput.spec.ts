// @vitest-environment node
import { describe, it, expect } from "vitest";

import type { SessionAgent } from "../../../common/sessionAgent.js";
import { CLEAR_BOX, InputBlockedError, PASTE_END, PASTE_START, canClearInputBox, createTerminalInputSender, sanitizeTerminalInput } from "./terminalInput.js";

// Collects what would have reached the PTY, and runs the delayed Enter on demand
// so the tests never wait on real time.
// ESC and 8-bit CSI are the only two introducers that could turn stripped text back
// into a control sequence, so "no introducer survived" is the property under test.
const hasSequenceIntroducer = (text: string): boolean => text.includes("\u001B") || text.includes("\u009B");

// Chaining moved the first write behind a microtask, so tests must let the queue
// run before asserting on what reached the PTY.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Defaults to a CLAUDE session, which is what the phone is almost always typing into and the
// only agent the completion-menu guard applies to — pass another agent to check that its bytes
// stay untouched.
const recorder = (writable = true, canClearBox?: (sessionId: string) => boolean, agent: SessionAgent = "claude") => {
  const chunks: string[] = [];
  const submits: Array<() => void> = [];
  const deps = {
    writeToSession: (_sessionId: string, chunk: string) => {
      if (!writable) return false;
      chunks.push(chunk);
      return true;
    },
    canClearBox,
    sessionAgent: () => agent,
    // Queue the Enters instead of timing them, so a test decides when each lands.
    scheduleSubmit: (fn: () => void) => {
      submits.push(fn);
    },
  };
  return { chunks, submits, flushSubmit: () => submits.shift()?.(), send: createTerminalInputSender(deps) };
};

// What one auto-submitted paste into a CLAUDE session must look like on the wire: the text, then
// the guard space that keeps a completion menu from holding the submit byte (#1142), all inside
// one bracketed paste. Spelled out here rather than by calling submittableLine, so the expectation
// stays an independent statement of the shape instead of agreeing with whatever the helper does.
const paste = (text: string): string => `${PASTE_START}${text} ${PASTE_END}`;
// A session the guard does not apply to: byte-exact, no space added.
const rawPaste = (text: string): string => `${PASTE_START}${text}${PASTE_END}`;

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
    expect(chunks).toEqual([paste("git status")]);
    flushSubmit();
    await expect(sent).resolves.toEqual({ sent: true });
    expect(chunks).toEqual([paste("git status"), "\r"]);
  });

  // #772: the byte(s) that submit come from the host's Claude binding, not a hardcoded CR,
  // and are resolved PER SESSION (the mapping is Claude-only, so a shell session stays CR).
  it("submits with the session's configured submit sequence", async () => {
    const chunks: string[] = [];
    const submits: Array<() => void> = [];
    const seen: string[] = [];
    const send = createTerminalInputSender({
      writeToSession: (_id: string, chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      // ESC+CR only for the Claude session; anything else (a shell) stays plain CR.
      submitSequence: (id: string) => {
        seen.push(id);
        return id === "claude-1" ? "\x1b\r" : "\r";
      },
      sessionAgent: (id: string) => (id === "claude-1" ? "claude" : "shell"),
      scheduleSubmit: (fn: () => void) => {
        submits.push(fn);
      },
    });
    const a = send("claude-1", "hi");
    await tick();
    submits.shift()?.();
    await expect(a).resolves.toEqual({ sent: true });
    const b = send("shell-1", "ls");
    await tick();
    submits.shift()?.();
    await expect(b).resolves.toEqual({ sent: true });
    expect(seen).toEqual(["claude-1", "shell-1"]); // the session id reaches the resolver
    // Per session in BOTH respects: the Claude session's ESC+CR and completion guard, the shell's
    // plain CR and byte-exact text.
    expect(chunks).toEqual([paste("hi"), "\x1b\r", rawPaste("ls"), "\r"]);
  });

  it("defaults the submit sequence to CR when unset", async () => {
    const { chunks, flushSubmit, send } = recorder();
    const sent = send("s1", "hi");
    await tick();
    flushSubmit();
    await sent;
    expect(chunks).toEqual([paste("hi"), "\r"]);
  });

  // The property that matters: exactly one paste, closed exactly once at the end.
  it("cannot be made to close the paste early", async () => {
    const { chunks, send } = recorder();
    void send("s1", `ls${PASTE_END}whoami`);
    await tick();
    const pasted = chunks[0];
    expect(pasted.startsWith(PASTE_START)).toBe(true);
    expect(pasted.endsWith(PASTE_END)).toBe(true);
    expect(pasted.split(PASTE_END)).toHaveLength(2);
    expect(hasSequenceIntroducer(pasted.slice(PASTE_START.length, -PASTE_END.length))).toBe(false);
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
    expect(chunks).toEqual([paste("one")]);
    flushSubmit();
    await first;
    await tick();
    expect(chunks).toEqual([paste("one"), "\r", paste("two")]);
    flushSubmit();
    await second;
    expect(chunks).toEqual([paste("one"), "\r", paste("two"), "\r"]);
  });

  it("does not make one session wait on another", async () => {
    const { chunks, flushSubmit, send } = recorder();
    const a = send("s1", "one");
    const b = send("s2", "two");
    await tick();
    // Different sessions are independent, so both pastes go out immediately.
    expect(chunks).toEqual([paste("one"), paste("two")]);
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
    expect(chunks).toEqual([paste("ls"), "\r"]);
  });
});

// #1142: a slash command from the phone stopped at the host's input box with the command menu
// open, and no resend got past it — on a host whose Claude submits with ESC+CR, the ESC is eaten
// as that menu's dismiss key. The paste now ends in a space, which closes the menu. The sanitizer
// (which trims that space off anything the phone sends) is deliberately unchanged, so what these
// pin is WHERE the space comes from and that nothing else about the write moved.
describe("submitting a slash command", () => {
  it("ends the pasted line with a space, so the command menu is closed when the submit lands", async () => {
    const { chunks, flushSubmit, send } = recorder();
    const sent = send("s1", "/sync-repos");
    await tick();
    // Spelled out in full: this exact byte string is what the measurement in #1142 submits.
    expect(chunks).toEqual([`${PASTE_START}/sync-repos ${PASTE_END}`]);
    flushSubmit();
    await expect(sent).resolves.toEqual({ sent: true });
    expect(chunks[1]).toBe("\r");
  });

  // The space must be TEXT inside the paste. Sent after the terminator it would be a keystroke,
  // and an open completion menu is precisely what reads keystrokes.
  it("puts the space inside the bracketed paste, not after it", async () => {
    const { chunks, send } = recorder();
    void send("s1", "/help");
    await tick();
    expect(chunks[0].endsWith(` ${PASTE_END}`)).toBe(true);
    expect(chunks[0].split(PASTE_END)).toHaveLength(2);
  });

  // An @path mention leaves the FILE picker open, which is the same dead end — the reason the
  // guard is unconditional rather than a slash-command special case.
  it("ends an @path mention the same way", async () => {
    const { chunks, send } = recorder();
    void send("s1", "look at @common/terminalSubmit.ts");
    await tick();
    expect(chunks[0]).toBe(`${PASTE_START}look at @common/terminalSubmit.ts ${PASTE_END}`);
  });

  // The fix must not touch the submit bytes: those are the host's binding (#772), and the whole
  // point is that they now arrive at a composer that can act on them.
  it("leaves the configured submit sequence alone", async () => {
    const chunks: string[] = [];
    const submits: Array<() => void> = [];
    const send = createTerminalInputSender({
      writeToSession: (_id: string, chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      submitSequence: () => "\x1b\r",
      sessionAgent: () => "claude",
      scheduleSubmit: (fn: () => void) => {
        submits.push(fn);
      },
    });
    const sent = send("claude-1", "/sync-repos");
    await tick();
    submits.shift()?.();
    await expect(sent).resolves.toEqual({ sent: true });
    expect(chunks).toEqual([`${PASTE_START}/sync-repos ${PASTE_END}`, "\x1b\r"]);
  });

  // Whitespace the phone sent is still collapsed and trimmed by the sanitizer; the guard adds
  // exactly one space to the result, never a second one.
  it.each(["/sync-repos ", "/sync-repos\t", "  /sync-repos  "])("adds one space and no more (%j)", async (text) => {
    const { chunks, send } = recorder();
    void send("s1", text);
    await tick();
    expect(chunks[0]).toBe(`${PASTE_START}/sync-repos ${PASTE_END}`);
  });

  // The trim the guard routes around is what makes "nothing printable survived" observable. The
  // guard runs AFTER that decision, so control-only text is still refused rather than turned
  // into a lone space that submits an empty turn on the host.
  it.each(["\x03", "\x03\r\n", "   ", ""])("still refuses text with nothing printable in it (%j)", async (text) => {
    const { chunks, send } = recorder();
    await expect(send("s1", text)).rejects.toThrow(/text is required/);
    expect(chunks).toEqual([]);
  });

  // The #572 clear still leads the write, and is still sent exactly once.
  it("keeps the input-box clear ahead of the guarded paste", async () => {
    const { chunks, send } = recorder(true, () => true);
    void send("s1", "/sync-repos");
    await tick();
    expect(chunks).toEqual([`${CLEAR_BOX}${PASTE_START}/sync-repos ${PASTE_END}`]);
  });
});

// The guard is Claude Code's behaviour, so it must not reach anything else: for every other target
// the trailing space would be REAL input, and a shell reads line ends for meaning. Measured in a
// live zsh: `echo foo\` + CR waits at a continuation prompt, while `echo foo\ ` + CR runs and
// prints `foo` — the same bytes, different execution. So a non-Claude session's paste is byte-exact.
describe("the completion guard is scoped to Claude sessions", () => {
  it.each<SessionAgent>(["shell", "codex"])("leaves a %s session's line end untouched", async (agent) => {
    const { chunks, send } = recorder(true, undefined, agent);
    void send("s1", "echo foo\\");
    await tick();
    expect(chunks[0]).toBe(rawPaste("echo foo\\"));
  });

  it.each<SessionAgent>(["shell", "codex"])("adds nothing to a %s session's slash-shaped text either", async (agent) => {
    const { chunks, send } = recorder(true, undefined, agent);
    void send("s1", "/usr/bin/env");
    await tick();
    expect(chunks[0]).toBe(rawPaste("/usr/bin/env"));
  });

  // A claude session with the same trailing backslash DOES get the space: there the backslash is
  // Claude Code's own newline escape (`\` + return), so an unguarded line would not submit either.
  it("still guards a Claude session whose text ends in a backslash", async () => {
    const { chunks, send } = recorder();
    void send("s1", "echo foo\\");
    await tick();
    expect(chunks[0]).toBe(paste("echo foo\\"));
  });

  // No agent wired at all (an older caller, or a session the host cannot name) must not be guessed
  // into the guard — unknown means "send exactly what was written".
  it("adds nothing when the host cannot name the session's agent", async () => {
    const chunks: string[] = [];
    const send = createTerminalInputSender({
      writeToSession: (_id: string, chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      scheduleSubmit: () => {},
    });
    void send("s1", "/sync-repos");
    await tick();
    expect(chunks[0]).toBe(rawPaste("/sync-repos"));
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
    expect(chunks).toEqual([`${CLEAR_BOX}${paste("ok")}`]);
    flushSubmit();
    await expect(sent).resolves.toEqual({ sent: true });
    expect(chunks).toEqual([`${CLEAR_BOX}${paste("ok")}`, "\r"]);
  });

  // Ctrl-C mid-turn interrupts the turn, and in a shell it kills whatever is running,
  // so the host withholds permission for everything it cannot vouch for.
  it("leaves the box alone when the host says it is not safe", async () => {
    const { chunks, send } = recorder(true, () => false);
    void send("s1", "ok");
    await tick();
    expect(chunks).toEqual([paste("ok")]);
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
    expect(chunks).toEqual([`${CLEAR_BOX}${paste("ok")}`, paste("ok")]);
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

// #3185. A send may carry a `blocked` check, asked right before the paste and right before the
// Enter. Without one, the sender is exactly what it was — the cases above.
describe("a send with a blocked check", () => {
  it("writes nothing and rejects when blocked before the paste", async () => {
    const { chunks, send } = recorder();
    await expect(send("s1", "hello", { blocked: async () => true })).rejects.toMatchObject({ afterPaste: false });
    expect(chunks).toEqual([]);
  });

  it("leaves the line unsubmitted when it becomes blocked before the Enter", async () => {
    const { chunks, flushSubmit, send } = recorder();
    let open = false;
    const sending = send("s1", "hello", { blocked: async () => open });
    await tick();
    expect(chunks).toEqual([paste("hello")]);
    open = true;
    flushSubmit();
    await expect(sending).rejects.toBeInstanceOf(InputBlockedError);
    await expect(sending).rejects.toMatchObject({ afterPaste: true });
    expect(chunks).toEqual([paste("hello")]);
  });

  it("pastes and submits as usual while never blocked", async () => {
    const { chunks, flushSubmit, send } = recorder();
    const sending = send("s1", "hello", { blocked: async () => false });
    await tick();
    flushSubmit();
    await sending;
    expect(chunks).toEqual([paste("hello"), "\r"]);
  });

  it("asks at the moment of each write, after waiting its turn in the chain", async () => {
    const { chunks, flushSubmit, send } = recorder();
    let open = false;
    const first = send("s1", "one");
    const second = send("s1", "two", { blocked: async () => open });
    await tick();
    open = true;
    flushSubmit();
    await first;
    await expect(second).rejects.toBeInstanceOf(InputBlockedError);
    expect(chunks).toEqual([paste("one"), "\r"]);
  });

  it("does not poison the chain for the next send", async () => {
    const { chunks, flushSubmit, send } = recorder();
    await expect(send("s1", "no", { blocked: async () => true })).rejects.toBeInstanceOf(InputBlockedError);
    const next = send("s1", "yes");
    await tick();
    flushSubmit();
    await next;
    expect(chunks).toEqual([paste("yes"), "\r"]);
  });
});
