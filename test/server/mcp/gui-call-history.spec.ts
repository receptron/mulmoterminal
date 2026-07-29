import { describe, it, expect, vi } from "vitest";

import { brokerRecordsGuiCalls, guiCallRecorderFor, historyIsGuiOnly, type ToolCallSink } from "../../../server/mcp/gui-call-history.js";

const sink = (): ToolCallSink & { starts: unknown[]; ends: unknown[] } => {
  const starts: unknown[] = [];
  const ends: unknown[] = [];
  return {
    starts,
    ends,
    recordToolCallStart: async (id, call) => void starts.push({ id, call }),
    recordToolCallEnd: async (id, call) => void ends.push({ id, call }),
  };
};

describe("brokerRecordsGuiCalls", () => {
  it("records for the agents that have no hooks of their own", () => {
    expect(brokerRecordsGuiCalls({ agent: "codex", reportsOwnCalls: false })).toBe(true);
    expect(brokerRecordsGuiCalls({ agent: "antigravity", reportsOwnCalls: false })).toBe(true);
  });

  // The regression this gate was rewritten for: a codex LAUNCHER CHIP runs `zsh -lc exec codex …`,
  // so its PtyEntry is labelled "shell" and no agent name says codex anywhere. Matching on the
  // name left that cell — a real codex session calling our tools — with a permanently empty pane.
  it("records for a codex launcher chip, whose session is labelled a shell", () => {
    expect(brokerRecordsGuiCalls({ agent: "shell", reportsOwnCalls: false })).toBe(true);
  });

  // The other half: claude's PreToolUse/PostToolUse match "" and so already report every mcp__
  // call. Recording here too would list each GUI call twice — and with a different id each time,
  // so nothing downstream could collapse them.
  it("does NOT record a session that reports its own calls", () => {
    expect(brokerRecordsGuiCalls({ agent: "claude", reportsOwnCalls: true })).toBe(false);
  });

  // The backstop, for a claude session that outlived a restart and was never reattached here, so
  // nothing added it to hookedSessions — its pane command still says what it is.
  it("does NOT record a claude session this process never spawned", () => {
    expect(brokerRecordsGuiCalls({ agent: "claude", reportsOwnCalls: false })).toBe(false);
  });

  // Neither signal says claude, so nothing else is writing this history.
  it("records an unknown session", () => {
    expect(brokerRecordsGuiCalls({ agent: null, reportsOwnCalls: false })).toBe(true);
  });
});

describe("historyIsGuiOnly", () => {
  it("says so for the sessions the broker actually feeds", () => {
    expect(historyIsGuiOnly({ agent: "codex", reportsOwnCalls: false })).toBe(true);
    expect(historyIsGuiOnly({ agent: "shell", reportsOwnCalls: false })).toBe(true);
  });

  it("says nothing for a hook-fed session", () => {
    expect(historyIsGuiOnly({ agent: "claude", reportsOwnCalls: true })).toBe(false);
  });

  // The claim is asked EARLY — the browser holds a session id before the agent is spawned — so a
  // claude session can be asked about before spawnClaudePty registers its hooks. Both signals then
  // say "not claude", and answering the recording gate here would tell the user that claude's
  // complete hook-fed history contains GUI calls only. Nothing visible means nothing claimed.
  it("says nothing about a session it cannot see yet", () => {
    expect(brokerRecordsGuiCalls({ agent: null, reportsOwnCalls: false })).toBe(true);
    expect(historyIsGuiOnly({ agent: null, reportsOwnCalls: false })).toBe(false);
  });
});

describe("guiCallRecorderFor", () => {
  it("is null for an agent that reports its own calls", () => {
    expect(guiCallRecorderFor("s1", { agent: "claude", reportsOwnCalls: true }, sink())).toBeNull();
    expect(guiCallRecorderFor("s1", { agent: "claude", reportsOwnCalls: false }, sink())).toBeNull();
  });

  it("routes start and end to the sink under the session id", () => {
    const s = sink();
    const recorder = guiCallRecorderFor("s1", { agent: "codex", reportsOwnCalls: false }, s);
    recorder?.start({ toolUseId: "u1", toolName: "presentDocument", toolInput: { a: 1 } });
    recorder?.end({ toolUseId: "u1", toolName: "presentDocument", toolInput: { a: 1 }, toolOutput: "ok", durationMs: 12, status: "completed" });
    expect(s.starts).toEqual([{ id: "s1", call: { toolUseId: "u1", toolName: "presentDocument", toolInput: { a: 1 } } }]);
    expect(s.ends).toEqual([
      { id: "s1", call: { toolUseId: "u1", toolName: "presentDocument", toolInput: { a: 1 }, toolOutput: "ok", durationMs: 12, status: "completed" } },
    ]);
  });

  // It sits on the tool-call path: a failed history write must cost a row in a pane, never the
  // agent's tool call.
  it("swallows a rejected write instead of throwing at the caller", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ToolCallSink = {
      recordToolCallStart: () => Promise.reject(new Error("disk full")),
      recordToolCallEnd: () => Promise.reject(new Error("disk full")),
    };
    const recorder = guiCallRecorderFor("s1", { agent: "codex", reportsOwnCalls: false }, failing);
    expect(() => recorder?.start({ toolUseId: "u1", toolName: "presentDocument", toolInput: {} })).not.toThrow();
    await Promise.resolve();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
