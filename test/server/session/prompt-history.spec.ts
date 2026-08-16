// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  claudeHistoryPrompt,
  claudePromptsFor,
  historyIdsFor,
  codexPrompts,
  promptWindow,
  transcriptPrompts,
  PROMPT_TEXT_CAP,
  PROMPT_HISTORY_MAX,
  PROMPT_SCAN_LIMIT,
} from "../../../server/session/prompt-history";
import type { PromptEntry } from "../../../common/promptHistory";

// A ~/.claude/history.jsonl line, as claude writes it (verified against the real file, #1748).
const historyLine = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  display: "make the header green",
  pastedContents: {},
  timestamp: 1786847885862,
  project: "/Users/me/repo",
  sessionId: "s1",
  ...over,
});

// A codex rollout row: the payload type is what identifies it, and the outer type must be
// event_msg — a response_item carrying the same payload type is a different record.
const codexLine = (message: unknown, ts = "2026-08-16T02:31:02.318Z"): Record<string, unknown> => ({
  type: "event_msg",
  timestamp: ts,
  payload: { type: "user_message", message },
});

describe("claudeHistoryPrompt", () => {
  it("reads the text, the time and the session off a real line", () => {
    expect(claudeHistoryPrompt(historyLine())).toEqual({
      sessionId: "s1",
      prompt: { at: 1786847885862, text: "make the header green" },
    });
  });

  it("drops a record with no session id — it cannot be scoped to a cell", () => {
    expect(claudeHistoryPrompt(historyLine({ sessionId: undefined }))).toBeNull();
    expect(claudeHistoryPrompt(historyLine({ sessionId: 42 }))).toBeNull();
  });

  it("drops a record whose text is absent, blank or not a string", () => {
    expect(claudeHistoryPrompt(historyLine({ display: undefined }))).toBeNull();
    expect(claudeHistoryPrompt(historyLine({ display: "   " }))).toBeNull();
    expect(claudeHistoryPrompt(historyLine({ display: { text: "no" } }))).toBeNull();
  });

  it("keeps the prompt when only the TIME is unreadable", () => {
    expect(claudeHistoryPrompt(historyLine({ timestamp: "not a date" }))?.prompt).toEqual({ at: null, text: "make the header green" });
    expect(claudeHistoryPrompt(historyLine({ timestamp: undefined }))?.prompt.at).toBeNull();
  });

  it("caps a pasted wall of text, marking that it was cut", () => {
    const long = "x".repeat(PROMPT_TEXT_CAP + 500);
    const read = claudeHistoryPrompt(historyLine({ display: long }));
    expect(read?.prompt.text).toHaveLength(PROMPT_TEXT_CAP + 1);
    expect(read?.prompt.text.endsWith("…")).toBe(true);
  });
});

describe("claudePromptsFor", () => {
  it("keeps only this session's prompts, oldest first", () => {
    const records = [
      historyLine({ display: "one", timestamp: 1 }),
      historyLine({ display: "elsewhere", sessionId: "s2", timestamp: 2 }),
      historyLine({ display: "two", timestamp: 3 }),
    ];
    expect(claudePromptsFor(records, ["s1"])).toEqual([
      { at: 1, text: "one" },
      { at: 3, text: "two" },
    ]);
  });

  it("interleaves several ids in file order — one conversation whose id was reissued", () => {
    const records = [
      historyLine({ display: "before", timestamp: 1 }),
      historyLine({ display: "elsewhere", sessionId: "other", timestamp: 2 }),
      historyLine({ display: "after compact", sessionId: "s1-new", timestamp: 3 }),
    ];
    expect(claudePromptsFor(records, ["s1", "s1-new"]).map((p) => p.text)).toEqual(["before", "after compact"]);
  });

  it("keeps the NEWEST when there are more than the limit", () => {
    const records = Array.from({ length: 5 }, (_, i) => historyLine({ display: `p${i}`, timestamp: i }));
    expect(claudePromptsFor(records, ["s1"], 2)).toEqual([
      { at: 3, text: "p3" },
      { at: 4, text: "p4" },
    ]);
  });

  it("keeps trivial acks — 'merge' and 'ok' are instructions here, not noise", () => {
    const records = [historyLine({ display: "ok", timestamp: 1 }), historyLine({ display: "merge", timestamp: 2 })];
    expect(claudePromptsFor(records, ["s1"]).map((p) => p.text)).toEqual(["ok", "merge"]);
  });

  it("answers empty for no records, no ids, no match, and records of the wrong shape", () => {
    expect(claudePromptsFor([], ["s1"])).toEqual([]);
    expect(claudePromptsFor([historyLine()], [])).toEqual([]);
    expect(claudePromptsFor([historyLine()], ["other"])).toEqual([]);
    expect(claudePromptsFor([{}, { display: "x" }, { sessionId: "s1" }], ["s1"])).toEqual([]);
  });

  it("defaults to PROMPT_HISTORY_MAX rather than serving an unbounded list", () => {
    const records = Array.from({ length: PROMPT_HISTORY_MAX + 10 }, (_, i) => historyLine({ display: `p${i}`, timestamp: i }));
    expect(claudePromptsFor(records, ["s1"])).toHaveLength(PROMPT_HISTORY_MAX);
  });
});

// Codex, #1749: claude reissues its own session id on `/clear` AND `/compact` while still
// reporting to us under ours, so a pane keyed on our id alone freezes at that moment.
// Codex, #1749: after a `/clear` the rest of the app blanks the header, the title and the last
// reply, so the pane may not be the one surface still showing the ended conversation. The floor is
// a TIME because claude's prompt history is one file per user, with no seam at a clear.
describe("claudePromptsFor under a clear floor", () => {
  const at = (ms: number, display: string) => historyLine({ timestamp: ms, display });

  it("keeps only what was typed at or after the clear", () => {
    const records = [at(10, "before"), at(20, "at the clear"), at(30, "after")];
    expect(claudePromptsFor(records, ["s1"], PROMPT_HISTORY_MAX, 20).map((p) => p.text)).toEqual(["at the clear", "after"]);
  });

  it("keeps everything when no clear is recorded", () => {
    const records = [at(10, "before"), at(30, "after")];
    expect(claudePromptsFor(records, ["s1"], PROMPT_HISTORY_MAX, undefined).map((p) => p.text)).toEqual(["before", "after"]);
  });

  it("drops a prompt with no readable time UNDER a floor, and keeps it without one", () => {
    const undated = historyLine({ timestamp: "nonsense", display: "when?" });
    expect(claudePromptsFor([undated], ["s1"], PROMPT_HISTORY_MAX, 20)).toEqual([]);
    expect(claudePromptsFor([undated], ["s1"]).map((p) => p.text)).toEqual(["when?"]);
  });

  it("answers empty when everything predates the clear, rather than falling back to it", () => {
    expect(claudePromptsFor([at(1, "old"), at(2, "older")], ["s1"], PROMPT_HISTORY_MAX, 100)).toEqual([]);
  });
});

// The second id exists for `/clear`, which re-mints claude's own id (cleared-transcripts.ts).
// `/compact` is NOT one of these: measured over the 95 compacted transcripts on this machine, the
// 61 with prompts afterwards all kept the same id, so the chain built for it was removed (#1749).
describe("historyIdsFor", () => {
  it("reads under ours alone when no claude id is known, or it is still ours", () => {
    expect(historyIdsFor("ours", undefined)).toEqual(["ours"]);
    expect(historyIdsFor("ours", "ours")).toEqual(["ours"]);
  });

  it("adds claude's own id once it differs, ours first", () => {
    expect(historyIdsFor("ours", "re-minted")).toEqual(["ours", "re-minted"]);
  });
});

// Codex, #1749: capping AT the window makes "exactly 100 prompts" indistinguishable from "1000
// prompts, 900 dropped", and the pane then tells a complete list that its older entries are gone.
describe("promptWindow", () => {
  const found = (n: number): PromptEntry[] => Array.from({ length: n }, (_, i) => ({ at: i, text: `p${i}` }));

  it("does not claim older prompts exist when the count lands exactly on the window", () => {
    const window = promptWindow(found(PROMPT_HISTORY_MAX));
    expect(window.prompts).toHaveLength(PROMPT_HISTORY_MAX);
    expect(window.truncated).toBe(false);
  });

  it("claims them at one over, and serves the newest window", () => {
    const window = promptWindow(found(PROMPT_SCAN_LIMIT));
    expect(window.truncated).toBe(true);
    expect(window.prompts).toHaveLength(PROMPT_HISTORY_MAX);
    expect(window.prompts[0]?.text).toBe("p1"); // the oldest is the one dropped
  });

  it("is quiet about truncation for an empty or short list", () => {
    expect(promptWindow([])).toEqual({ prompts: [], truncated: false });
    expect(promptWindow(found(3)).truncated).toBe(false);
  });

  it("PROMPT_SCAN_LIMIT is the one-over a reader must ask for", () => {
    expect(PROMPT_SCAN_LIMIT).toBe(PROMPT_HISTORY_MAX + 1);
  });
});

describe("codexPrompts", () => {
  it("reads user_message events, with the ISO timestamp as epoch ms", () => {
    expect(codexPrompts([codexLine("review the branch")])).toEqual([{ at: Date.parse("2026-08-16T02:31:02.318Z"), text: "review the branch" }]);
  });

  it("ignores every other record — including a payload of the same type that is not an event_msg", () => {
    const notAnEvent = { type: "response_item", timestamp: "2026-08-16T02:31:02.318Z", payload: { type: "user_message", message: "no" } };
    const otherEvent = { type: "event_msg", payload: { type: "agent_message", message: "no" } };
    expect(codexPrompts([notAnEvent, otherEvent, {}, { payload: null }])).toEqual([]);
  });

  it("drops a message that is blank or not a string, and keeps the newest within the limit", () => {
    const records = [codexLine(""), codexLine({ text: "no" }), codexLine("a"), codexLine("b")];
    expect(codexPrompts(records, 1)).toEqual([{ at: Date.parse("2026-08-16T02:31:02.318Z"), text: "b" }]);
  });
});

describe("transcriptPrompts (the fallback)", () => {
  const userRecord = (content: unknown, timestamp = "2026-08-16T02:31:02.318Z") => ({ type: "user", timestamp, message: { role: "user", content } });

  it("reads plain and block content", () => {
    const records = [userRecord("typed"), userRecord([{ type: "text", text: "blocks" }])];
    expect(transcriptPrompts(records).map((p) => p.text)).toEqual(["typed", "blocks"]);
  });

  it("skips harness-injected user records and tool results", () => {
    const records = [
      userRecord("<local-command-stdout>ran</local-command-stdout>"),
      userRecord("<task-notification>done</task-notification>"),
      userRecord([{ type: "tool_result", tool_use_id: "t1", content: "output" }]),
      { type: "assistant", message: { content: "not a prompt" } },
    ];
    expect(transcriptPrompts(records)).toEqual([]);
  });

  it("answers empty rather than throwing on records of the wrong shape", () => {
    expect(transcriptPrompts([{ type: "user" }, { type: "user", message: "text" }, {}])).toEqual([]);
  });
});
