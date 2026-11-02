// @vitest-environment node
// The name other Claude Code sessions message one of ours by (#3237): read from Claude Code's own
// registry entry, and matched to a cell through the tmux session MulmoTerminal named for it.
import { describe, it, expect } from "vitest";
import { MAX_PEER_NAME_CHARS, parseClaudePeer, peerNameFor, tmuxSessionOf, type ClaudePeer } from "../../../../server/agents/claude/claude-peers";

// One entry as Claude Code 2.1.292 writes it, the fields this reads and a few it does not.
const ENTRY = {
  pid: 14188,
  sessionId: "17190482-1062-4367-8085-6634d8738a46",
  cwd: "/Users/you/mulmoclaude",
  startedAt: 1793620670575,
  version: "2.1.292",
  kind: "interactive",
  tmux: "mt-101256a4-131e-4921-b905-9f86e419928c:@0.%0",
  name: "mulmoclaude-c4",
  nameSource: "derived",
  status: "idle",
  updatedAt: 1793623857518,
};

const peer = (over: Partial<ClaudePeer>): ClaudePeer => ({ name: "proj-ab", pid: 1, sessionId: null, tmuxSession: null, updatedAt: 0, ...over });

describe("parseClaudePeer", () => {
  it("reads the name, the process, claude's id and the tmux session off an entry", () => {
    expect(parseClaudePeer(ENTRY)).toEqual({
      name: "mulmoclaude-c4",
      pid: 14188,
      sessionId: "17190482-1062-4367-8085-6634d8738a46",
      tmuxSession: "mt-101256a4-131e-4921-b905-9f86e419928c",
      updatedAt: 1793623857518,
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
    expect(parseClaudePeer({ pid: 7, name: "proj-ab" })).toEqual({ name: "proj-ab", pid: 7, sessionId: null, tmuxSession: null, updatedAt: 0 });
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
});
