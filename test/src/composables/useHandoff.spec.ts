import { describe, it, expect } from "vitest";
import {
  pickHandoffTargets,
  pullLastTurn,
  pullSinceRelay,
  sendLastTurn,
  sendSinceRelay,
  slotLabel,
  type HandoffDeps,
  type HandoffTarget,
  type RelayDeps,
} from "../../../src/composables/useHandoff";
import type { SlotInfo } from "../../../src/composables/readableSlot";

const slot = (key: string, agent: "claude" | "codex" = "claude", cwd: string | null = "/Users/me/work/proj", sessionId = `sess-${key}`): SlotInfo => ({
  key,
  sessionId,
  agent,
  cwd,
});

const target = (key = "cell-2"): HandoffTarget => ({ key, label: key, source: { sessionId: `sess-${key}`, cwd: "/w", agent: "claude" } });

const deps = (over: Partial<HandoffDeps>): HandoffDeps => ({
  fetchText: async () => "excerpt",
  paste: () => true,
  ...over,
});

describe("pickHandoffTargets", () => {
  it("lists the other cells with their number, agent, and directory", () => {
    const targets = pickHandoffTargets([slot("cell-1"), slot("cell-2", "codex")], "cell-1", "/Users/me");
    expect(targets).toEqual([
      { key: "cell-2", label: "#2 · codex · ~/work/proj", source: { sessionId: "sess-cell-2", cwd: "/Users/me/work/proj", agent: "codex" } },
    ]);
  });

  it("carries each cell's own session, so the pull reads that cell's log", () => {
    const targets = pickHandoffTargets([slot("cell-1"), slot("cell-2", "codex"), slot("cell-3")], "cell-1", null);
    expect(targets.map((t) => t.source.sessionId)).toEqual(["sess-cell-2", "sess-cell-3"]);
    expect(targets.map((t) => t.source.agent)).toEqual(["codex", "claude"]);
  });

  it("excludes the asking cell, so a session can't be pulled into itself", () => {
    expect(pickHandoffTargets([slot("cell-3")], "cell-3", null)).toEqual([]);
  });

  it("is empty when nothing else is connected", () => {
    expect(pickHandoffTargets([], "cell-1", null)).toEqual([]);
  });

  it("omits the directory for a slot the server hasn't resolved yet", () => {
    expect(pickHandoffTargets([slot("cell-2", "claude", null)], "cell-1", null)[0].label).toBe("#2 · claude");
  });

  it("falls back to the raw key for a non-grid slot", () => {
    expect(pickHandoffTargets([slot("single", "claude", null)], "cell-1", null)[0].label).toBe("single · claude");
  });
});

describe("pullLastTurn", () => {
  it("reads the CHOSEN cell's log and pastes into the asking cell", async () => {
    const read: string[] = [];
    const pasted: Array<[string, string]> = [];
    const error = await pullLastTurn(
      target("cell-2"),
      "cell-1",
      deps({
        fetchText: async (source) => (read.push(source.sessionId), "excerpt"),
        paste: (key, text) => (pasted.push([key, text]), true),
      }),
    );
    expect(error).toBeNull();
    expect(read).toEqual(["sess-cell-2"]); // the source is the cell that was picked...
    expect(pasted).toEqual([["cell-1", "excerpt"]]); // ...and the destination is the cell that asked
  });

  it("says there is nothing to bring over rather than pasting an empty block", async () => {
    let pasteCalls = 0;
    const error = await pullLastTurn(target(), "cell-1", deps({ fetchText: async () => "", paste: () => (pasteCalls++, true) }));
    expect(error).toBe("That terminal has no completed turn yet");
    expect(pasteCalls).toBe(0);
  });

  it("reports a failed read instead of throwing at the cell", async () => {
    const error = await pullLastTurn(
      target(),
      "cell-1",
      deps({
        fetchText: async () => {
          throw new Error("500");
        },
      }),
    );
    expect(error).toBe("Could not read that terminal's last turn");
  });

  it("reports when this cell's own socket has gone", async () => {
    expect(await pullLastTurn(target(), "cell-1", deps({ paste: () => false }))).toBe("This terminal is not connected");
  });
});

// Every seat at a round table is named the same way, including the cell that STARTS it — the
// first live run put a bare `#0` in the framing beside `#1 · codex · …/proj`, so the message told
// the reader "Also at the table: #0" and named something it could not identify (#1456).
describe("slotLabel", () => {
  it("names a slot by cell, agent and directory", () => {
    expect(slotLabel({ key: "cell-3", sessionId: "S", cwd: "/home/u/proj", agent: "codex" }, "/home/u")).toContain("#3");
    expect(slotLabel({ key: "cell-3", sessionId: "S", cwd: "/home/u/proj", agent: "codex" }, "/home/u")).toContain("codex");
  });

  it("falls back to cell and agent when the slot has no directory", () => {
    expect(slotLabel({ key: "cell-1", sessionId: "S", cwd: null, agent: "claude" }, null)).toBe("#1 · claude");
  });
});

describe("pullSinceRelay", () => {
  const MARK = "a".repeat(64);
  const relayDeps = (over: Partial<RelayDeps> = {}): RelayDeps => ({
    fetchRelay: async () => ({ status: "ok", text: "relayed", mark: MARK }),
    paste: () => true,
    recordMark: async () => {},
    ...over,
  });

  it("pastes into the asking cell, then records the marker for its directory", async () => {
    const recorded: Array<[string, string, string]> = [];
    const pasted: Array<[string, string]> = [];
    const error = await pullSinceRelay(
      target("cell-2"),
      "cell-1",
      "/dest",
      relayDeps({
        paste: (key, text) => (pasted.push([key, text]), true),
        recordMark: async (source, dest, mark) => void recorded.push([source.sessionId, dest, mark]),
      }),
    );
    expect(error).toBeNull();
    expect(pasted).toEqual([["cell-1", "relayed"]]);
    expect(recorded).toEqual([["sess-cell-2", "/dest", MARK]]);
  });

  it("does not move the marker when the paste fails", async () => {
    let recordCalls = 0;
    const error = await pullSinceRelay(
      target(),
      "cell-1",
      "/dest",
      relayDeps({
        paste: () => false,
        recordMark: async () => {
          recordCalls++;
        },
      }),
    );
    expect(error).toBe("This terminal is not connected");
    expect(recordCalls).toBe(0);
  });

  it.each([
    ["nothing-new", "Nothing new since the last relay"],
    ["no-turn", "That terminal has no completed turn yet"],
  ] as const)("reports %s without pasting", async (status, message) => {
    let pasteCalls = 0;
    const error = await pullSinceRelay(
      target(),
      "cell-1",
      "/dest",
      relayDeps({ fetchRelay: async () => ({ status, text: "", mark: null }), paste: () => (pasteCalls++, true) }),
    );
    expect(error).toBe(message);
    expect(pasteCalls).toBe(0);
  });

  it("reports a failed read, a failed record, and a cell with no directory", async () => {
    expect(await pullSinceRelay(target(), "cell-1", "/dest", relayDeps({ fetchRelay: async () => Promise.reject(new Error("x")) }))).toBe(
      "Could not read that terminal's conversation",
    );
    expect(await pullSinceRelay(target(), "cell-1", "/dest", relayDeps({ recordMark: async () => Promise.reject(new Error("x")) }))).toMatch(/^Pasted, but/);
    expect(await pullSinceRelay(target(), "cell-1", null, relayDeps())).toBe("This terminal has no directory to remember the relay by");
  });
});

// #3397: the same two operations the other way round — this cell is the source, the partner the
// destination — with each message naming the right end.
describe("sendLastTurn / sendSinceRelay", () => {
  const MARK = "b".repeat(64);
  const self = { sessionId: "sess-self", cwd: "/src", agent: "claude" as const };
  const partner: HandoffTarget = { key: "cell-9", label: "#9", source: { sessionId: "sess-9", cwd: "/partner", agent: "codex" } };

  it("reads THIS cell's turn and pastes it into the partner", async () => {
    const read: unknown[] = [];
    const pasted: Array<[string, string]> = [];
    const error = await sendLastTurn(
      self,
      partner,
      deps({ fetchText: async (source) => (read.push(source), "mine"), paste: (key, text) => (pasted.push([key, text]), true) }),
    );
    expect(error).toBeNull();
    expect(read).toEqual([self]);
    expect(pasted).toEqual([["cell-9", "mine"]]);
  });

  it("names this cell as the source and the partner as the destination when it fails", async () => {
    expect(await sendLastTurn(self, partner, deps({ fetchText: async () => "" }))).toBe("This terminal has no completed turn yet");
    expect(await sendLastTurn(self, partner, deps({ fetchText: async () => Promise.reject(new Error("x")) }))).toBe("Could not read this terminal's last turn");
    expect(await sendLastTurn(self, partner, deps({ paste: () => false }))).toBe("That terminal is not connected");
  });

  it("relays since the last relay to the PARTNER's directory, and records it there", async () => {
    const fetched: Array<[unknown, string]> = [];
    const recorded: Array<[unknown, string, string]> = [];
    const pasted: string[] = [];
    const error = await sendSinceRelay(self, partner, {
      fetchRelay: async (source, dest) => (fetched.push([source, dest]), { status: "ok", text: "since", mark: MARK }),
      paste: (key) => (pasted.push(key), true),
      recordMark: async (source, dest, mark) => void recorded.push([source, dest, mark]),
    });
    expect(error).toBeNull();
    expect(fetched).toEqual([[self, "/partner"]]);
    expect(pasted).toEqual(["cell-9"]);
    expect(recorded).toEqual([[self, "/partner", MARK]]);
  });

  it("reports a partner with no directory, and nothing new, from the sender's side", async () => {
    const relay = (over: Partial<RelayDeps>): RelayDeps => ({
      fetchRelay: async () => ({ status: "ok", text: "t", mark: MARK }),
      paste: () => true,
      recordMark: async () => {},
      ...over,
    });
    const homeless = { ...partner, source: { ...partner.source, cwd: null } };
    expect(await sendSinceRelay(self, homeless, relay({}))).toBe("That terminal has no directory to remember the relay by");
    expect(await sendSinceRelay(self, partner, relay({ fetchRelay: async () => ({ status: "nothing-new", text: "", mark: null }) }))).toBe(
      "Nothing new since the last relay",
    );
    expect(await sendSinceRelay(self, partner, relay({ fetchRelay: async () => ({ status: "no-turn", text: "", mark: null }) }))).toBe(
      "This terminal has no completed turn yet",
    );
    expect(await sendSinceRelay(self, partner, relay({ paste: () => false }))).toBe("That terminal is not connected");
  });
});

// A session switch in the destination cell while the reads were in flight: nothing is pasted, and a
// since-relay records no mark, because the mark must describe the conversation that received it.
describe("the destination must still hold the conversation the action aimed at", () => {
  const self = { sessionId: "sess-self", cwd: "/src", agent: "claude" as const };
  const partner: HandoffTarget = { key: "cell-9", label: "#9", source: { sessionId: "sess-9", cwd: "/partner", agent: "codex" } };

  it("sendLastTurn refuses to paste into a partner that moved on", async () => {
    let pasted = 0;
    const error = await sendLastTurn(self, partner, deps({ paste: () => (pasted++, true), holds: () => false }));
    expect(error).toBe("That terminal is in a different conversation now");
    expect(pasted).toBe(0);
  });

  it("pullLastTurn says it of THIS cell", async () => {
    expect(await pullLastTurn(target(), "cell-1", deps({ holds: () => false }))).toBe("This terminal is in a different conversation now");
  });

  it("sendSinceRelay neither pastes nor records the mark", async () => {
    let pasted = 0;
    let recorded = 0;
    const error = await sendSinceRelay(self, partner, {
      fetchRelay: async () => ({ status: "ok", text: "t", mark: "c".repeat(64) }),
      paste: () => (pasted++, true),
      recordMark: async () => {
        recorded++;
      },
      holds: () => false,
    });
    expect(error).toBe("That terminal is in a different conversation now");
    expect([pasted, recorded]).toEqual([0, 0]);
  });

  it("asks about the destination key, and pastes when it still holds", async () => {
    const asked: string[] = [];
    expect(await sendLastTurn(self, partner, deps({ holds: (key) => (asked.push(key), true) }))).toBeNull();
    expect(asked).toEqual(["cell-9"]);
  });
});
