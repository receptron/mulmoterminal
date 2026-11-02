// @vitest-environment node
// The name other Claude Code sessions message one of ours by (#3237): read from Claude Code's own
// registry entry, and matched to a cell through the tmux session MulmoTerminal named for it.
import { describe, it, expect } from "vitest";
import {
  MAX_PEER_NAME_CHARS,
  parseClaudePeer,
  parsePsStartTimes,
  peerNameFor,
  START_TOLERANCE_MS,
  tmuxSessionOf,
  withVerifiedStarts,
  type ClaudePeer,
} from "../../../../server/agents/claude/claude-peers";

// One entry as Claude Code 2.1.292 writes it, the fields this reads and a few it does not.
const ENTRY = {
  pid: 14188,
  sessionId: "17190482-1062-4367-8085-6634d8738a46",
  cwd: "/Users/you/mulmoclaude",
  startedAt: 1793620670575,
  version: "2.1.292",
  kind: "interactive",
  entrypoint: "cli",
  tmux: "mt-101256a4-131e-4921-b905-9f86e419928c:@0.%0",
  name: "mulmoclaude-c4",
  nameSource: "derived",
  status: "idle",
  updatedAt: 1793623857518,
};

const peer = (over: Partial<ClaudePeer>): ClaudePeer => ({
  name: "proj-ab",
  pid: 1,
  sessionId: null,
  tmuxSession: null,
  startedBy: "unsaid",
  updatedAt: 0,
  startedAt: null,
  ...over,
});

describe("parseClaudePeer", () => {
  it("reads the name, the process, claude's id and the tmux session off an entry", () => {
    expect(parseClaudePeer(ENTRY)).toEqual({
      name: "mulmoclaude-c4",
      pid: 14188,
      sessionId: "17190482-1062-4367-8085-6634d8738a46",
      tmuxSession: "mt-101256a4-131e-4921-b905-9f86e419928c",
      startedBy: "terminal",
      updatedAt: 1793623857518,
      startedAt: 1793620670575,
    });
  });

  it.each([
    ["no name", { ...ENTRY, name: undefined }],
    ["an empty name", { ...ENTRY, name: "" }],
    ["no pid", { ...ENTRY, pid: undefined }],
    ["a pid that is not a process", { ...ENTRY, pid: 0 }],
    ["a pid written as text", { ...ENTRY, pid: "14188" }],
    ["not an object", "mulmoclaude-c4"],
  ])("is nothing with %s", (_what, value) => {
    expect(parseClaudePeer(value)).toBeNull();
  });

  // The name goes onto the wire, a tooltip, an aria-label and the clipboard, so a file whose name
  // is not one Claude Code would write is not an entry at all.
  it.each([
    ["a name past the bound", "x".repeat(MAX_PEER_NAME_CHARS + 1)],
    ["a name holding a newline", "proj-ab\nmore"],
    ["a name holding another control character", "proj\u0007ab"],
    ["a name that is only whitespace", "   "],
  ])("is nothing with %s", (_what, name) => {
    expect(parseClaudePeer({ ...ENTRY, name })).toBeNull();
  });

  it("keeps a name at the bound, trimmed", () => {
    const name = "y".repeat(MAX_PEER_NAME_CHARS);
    expect(parseClaudePeer({ ...ENTRY, name: ` ${name} ` })?.name).toBe(name);
  });

  it("has no tmux session and no id for a claude started outside both", () => {
    expect(parseClaudePeer({ pid: 7, name: "proj-ab" })).toEqual({
      name: "proj-ab",
      pid: 7,
      sessionId: null,
      tmuxSession: null,
      startedBy: "unsaid",
      updatedAt: 0,
      startedAt: null,
    });
  });

  // `entrypoint` is the raw CLAUDE_CODE_ENTRYPOINT of the process, so Claude Code writes a string
  // or nothing. Anything else is not an entry it wrote, and is not trusted to be the terminal's.
  it.each([
    ["an SDK's value", "sdk-cli"],
    ["a value in other letters", "CLI"],
    ["JSON null", null],
    ["a number", 42],
    ["a boolean", false],
    ["an object", { kind: "cli" }],
  ])("reads %s as a program's", (_what, entrypoint) => {
    expect(parseClaudePeer({ ...ENTRY, entrypoint })?.startedBy).toBe("program");
  });

  it("reads an empty entrypoint as unsaid, like an absent one", () => {
    expect(parseClaudePeer({ ...ENTRY, entrypoint: "" })?.startedBy).toBe("unsaid");
    expect(parseClaudePeer({ ...ENTRY, entrypoint: undefined })?.startedBy).toBe("unsaid");
  });

  it("dates an entry by its last write, else by its start", () => {
    expect(parseClaudePeer({ ...ENTRY, updatedAt: undefined })?.updatedAt).toBe(ENTRY.startedAt);
    expect(parseClaudePeer({ ...ENTRY, updatedAt: "later" })?.updatedAt).toBe(ENTRY.startedAt);
  });
});

describe("tmuxSessionOf", () => {
  it.each([
    ["mt-abc:@0.%0", "mt-abc"],
    ["mt-abc:@12.%34", "mt-abc"],
    ["mt-abc", "mt-abc"],
    [":@0.%0", null],
    ["", null],
    [undefined, null],
    [42, null],
  ])("%j -> %j", (target, session) => {
    expect(tmuxSessionOf(target)).toBe(session);
  });
});

describe("peerNameFor", () => {
  const keys = { sessionId: "s-1", tmuxSession: "mt-s-1" };

  it("names the peer in the cell's tmux session", () => {
    expect(peerNameFor([peer({ name: "proj-ab", tmuxSession: "mt-s-1" }), peer({ name: "proj-cd", tmuxSession: "mt-s-2" })], keys)).toBe("proj-ab");
  });

  // After `/clear` claude's own id is a new one while the tmux session is still the cell's, so the
  // tmux match is the one that holds; the id is for a claude started without tmux.
  it("prefers the tmux session to claude's id, and falls back to the id", () => {
    const byTmux = peer({ name: "in-tmux", tmuxSession: "mt-s-1", sessionId: "reissued" });
    const byId = peer({ name: "by-id", sessionId: "s-1" });
    expect(peerNameFor([byId, byTmux], keys)).toBe("in-tmux");
    expect(peerNameFor([byId], keys)).toBe("by-id");
  });

  // The same conversation resumed in another cell has this id and that cell's tmux session. It is
  // that cell's peer, not this one's, so the id alone does not claim it.
  it("does not take a peer that names another tmux session, whatever its id says", () => {
    const elsewhere = peer({ name: "elsewhere", sessionId: "s-1", tmuxSession: "mt-s-2" });
    expect(peerNameFor([elsewhere], keys)).toBeNull();
    expect(peerNameFor([elsewhere, peer({ name: "no-tmux", sessionId: "s-1" })], keys)).toBe("no-tmux");
  });

  it("is nothing when no peer runs the session", () => {
    expect(peerNameFor([peer({ tmuxSession: "mt-s-2", sessionId: "s-2" })], keys)).toBeNull();
    expect(peerNameFor([], keys)).toBeNull();
  });

  // A crashed claude's entry is filtered out by its dead pid before this; a resumed session whose
  // earlier process is still winding down is not, and the entry written last is the one running.
  it("takes the entry written last of two claiming one cell", () => {
    const older = peer({ name: "older", tmuxSession: "mt-s-1", updatedAt: 10 });
    const newer = peer({ name: "newer", tmuxSession: "mt-s-1", updatedAt: 20 });
    expect(peerNameFor([newer, older], keys)).toBe("newer");
    expect(peerNameFor([older, newer], keys)).toBe("newer");
  });

  // A program run from inside the cell (a plugin's `claude -p` over stream-json) inherits the pane
  // and registers on it, and rewrites its entry more often than an idle terminal does. What rules
  // it out is how it says it was started, not its age (#3244).
  it("passes over the sessions a program drove from inside the cell, however recently written", () => {
    const terminal = peer({ name: "terminal", tmuxSession: "mt-s-1", startedBy: "terminal", updatedAt: 10 });
    const driven = [20, 30, 40].map((updatedAt) => peer({ name: `driven-${String(updatedAt)}`, tmuxSession: "mt-s-1", startedBy: "program", updatedAt }));
    expect(peerNameFor([...driven, terminal], keys)).toBe("terminal");
    expect(peerNameFor([terminal, ...driven], keys)).toBe("terminal");
  });

  // A driven session is a live claude a peer could message, but it is not the one in the cell, so
  // a cell that has only those shows nothing rather than one of them.
  it("is nothing when only driven sessions claim the cell", () => {
    expect(peerNameFor([peer({ tmuxSession: "mt-s-1", startedBy: "program" })], keys)).toBeNull();
    expect(peerNameFor([peer({ sessionId: "s-1", startedBy: "program" })], keys)).toBeNull();
  });

  // A Claude Code that does not write the field is read as it was before the field was known.
  it("keeps an entry that does not say how it was started", () => {
    const unsaid = peer({ name: "unsaid", tmuxSession: "mt-s-1", updatedAt: 10 });
    const driven = peer({ name: "driven", tmuxSession: "mt-s-1", startedBy: "program", updatedAt: 20 });
    expect(peerNameFor([driven, unsaid], keys)).toBe("unsaid");
  });
});

describe("parsePsStartTimes", () => {
  it("reads pid and start off each line, local time, and skips what is not one", () => {
    const starts = parsePsStartTimes("  7848 Mon Nov  2 20:57:38 2026    \n 14188 Mon Nov  2 20:57:49 2026\nps: process id too large: 999999\n\n");
    expect([...starts.keys()]).toEqual([7848, 14188]);
    expect(starts.get(7848)).toBe(Date.parse("Mon Nov  2 20:57:38 2026"));
  });
});

describe("withVerifiedStarts", () => {
  const startedAt = 1_793_620_661_697; // the entry's own clock, a few seconds into the process
  const processStart = startedAt - 3_697; // what the OS says
  const entry = peer({ pid: 7848, startedAt });

  it("keeps a peer whose process started when its entry says, within the tolerance", () => {
    expect(withVerifiedStarts([entry], new Map([[7848, processStart]]))).toEqual([entry]);
    expect(withVerifiedStarts([entry], new Map([[7848, startedAt - START_TOLERANCE_MS]]))).toEqual([entry]);
    expect(withVerifiedStarts([entry], new Map([[7848, startedAt + START_TOLERANCE_MS]]))).toEqual([entry]);
  });

  // The pid came round again: some unrelated process owns the number now and started at another time.
  it("drops a peer whose number belongs to a process that started at another time", () => {
    expect(withVerifiedStarts([entry], new Map([[7848, startedAt + START_TOLERANCE_MS + 1]]))).toEqual([]);
    expect(withVerifiedStarts([entry], new Map([[7848, startedAt - START_TOLERANCE_MS - 1]]))).toEqual([]);
  });

  it("drops a peer the OS does not list, and one whose entry has no start of its own", () => {
    expect(withVerifiedStarts([entry], new Map())).toEqual([]);
    expect(withVerifiedStarts([peer({ pid: 7848, startedAt: null })], new Map([[7848, processStart]]))).toEqual([]);
  });

  it("keeps every live peer where the OS cannot say when a process started", () => {
    expect(withVerifiedStarts([entry, peer({ pid: 9, startedAt: null })], null)).toHaveLength(2);
  });
});
