// @vitest-environment node
// One transcript record into a conversation's summary and searchable text (#3328): the records
// claude writes today, and every way a record can be wrong without the fold throwing.
import { describe, it, expect } from "vitest";
import {
  conversationTitle,
  emptyConversationState,
  FIRST_PROMPT_TITLE_CAP,
  foldConversationRecord,
  isConversationState,
  prLinkOf,
  recordTime,
  TURN_TEXT_CAP,
  type ConversationState,
} from "../../../../server/backends/library/conversation-fold";

const fold = (records: Record<string, unknown>[]) => {
  const state = emptyConversationState();
  const turns = records.flatMap((record) => foldConversationRecord(state, record) ?? []);
  return { state, turns };
};

const user = (text: unknown, extra: Record<string, unknown> = {}) => ({ type: "user", message: { role: "user", content: text }, ...extra });
const assistant = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
  ...extra,
});

describe("foldConversationRecord: the records claude writes", () => {
  it("collects the summary fields from a realistic conversation", () => {
    const { state } = fold([
      user("字幕を焼き込みたい", { cwd: "/w/clip", gitBranch: "main", timestamp: "2026-11-18T08:00:00.000Z" }),
      { type: "ai-title", aiTitle: "Burn subtitles" },
      assistant("ffmpeg で焼き込みます", { gitBranch: "feat/burn", timestamp: "2026-11-18T08:05:00.000Z", attributionSkill: "gh-review-loop" }),
      { type: "pr-link", prNumber: 212, prUrl: "https://github.com/o/r/pull/212", prRepository: "o/r" },
      { type: "cost-state", totalCostUSD: 0.5, totalLinesAdded: 10, totalLinesRemoved: 2 },
      { type: "cost-state", totalCostUSD: 0.84, totalLinesAdded: 146, totalLinesRemoved: 12 },
      { type: "system", subtype: "stop_hook_summary", hookErrors: ["Failed with non-blocking status code"] },
    ]);
    expect(state).toMatchObject({
      aiTitle: "Burn subtitles",
      cwd: "/w/clip",
      gitBranch: "feat/burn",
      prs: [{ number: 212, url: "https://github.com/o/r/pull/212", repository: "o/r" }],
      costUsd: 0.84,
      linesAdded: 146,
      linesRemoved: 12,
      startedAt: Date.parse("2026-11-18T08:00:00.000Z"),
      endedAt: Date.parse("2026-11-18T08:05:00.000Z"),
      skills: ["gh-review-loop"],
      hookErrors: 1,
      userTurns: 1,
      isSidechain: false,
    });
  });

  it("answers the user and assistant prose as turns, and nothing else", () => {
    const { turns } = fold([
      user("hello", { timestamp: "2026-11-18T08:00:00.000Z" }),
      assistant("hi there"),
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: {} }] } },
      user([{ type: "tool_result", content: "file body" }]),
      { type: "attachment", attachment: { text: "x" } },
    ]);
    expect(turns).toEqual([
      { role: "user", text: "hello", at: Date.parse("2026-11-18T08:00:00.000Z") },
      { role: "assistant", text: "hi there", at: null },
    ]);
  });

  it("leaves injected text and meta records out of search and out of the turn count", () => {
    const { state, turns } = fold([
      user("<command-name>/clear</command-name>"),
      user("<system-reminder>be nice</system-reminder>"),
      user("Caveat: generated", { isMeta: true }),
    ]);
    expect(turns).toEqual([]);
    expect(state.userTurns).toBe(0);
  });

  it("caps a turn's text, and takes the first non-blank line of the first prompt as the title", () => {
    const { state, turns } = fold([user(`\n\n  first line\n${"x".repeat(TURN_TEXT_CAP * 2)}`), user("second prompt")]);
    expect(turns[0]?.text.length).toBe(TURN_TEXT_CAP);
    expect(state.firstPrompt).toBe("first line");
    expect(conversationTitle(state)).toBe("first line");
    const long = fold([user("y".repeat(FIRST_PROMPT_TITLE_CAP * 2))]);
    expect(long.state.firstPrompt?.length).toBe(FIRST_PROMPT_TITLE_CAP);
  });

  it("prefers a rename to the agent's title, and the agent's title to the first prompt", () => {
    const base = [user("the prompt"), { type: "ai-title", aiTitle: "AI title" }];
    expect(conversationTitle(fold(base).state)).toBe("AI title");
    expect(conversationTitle(fold([...base, { type: "custom-title", customTitle: "Mine" }]).state)).toBe("Mine");
    // An empty rename clears the name, and the next title down shows again.
    expect(conversationTitle(fold([...base, { type: "custom-title", customTitle: "Mine" }, { type: "custom-title", customTitle: " " }]).state)).toBe(
      "AI title",
    );
  });

  it("keeps each PR once, however often it is linked", () => {
    const link = { type: "pr-link", prNumber: 1, prUrl: "https://github.com/o/r/pull/1", prRepository: "o/r" };
    expect(fold([link, link, { ...link, prNumber: 2, prUrl: "https://github.com/o/r/pull/2" }]).state.prs.map((pr) => pr.number)).toEqual([1, 2]);
  });

  it("marks a conversation that has any sidechain record", () => {
    expect(fold([user("a"), assistant("b", { isSidechain: true })]).state.isSidechain).toBe(true);
  });

  it("keeps the first cwd and the newest branch", () => {
    const { state } = fold([user("a", { cwd: "/first", gitBranch: "one" }), user("b", { cwd: "/second", gitBranch: "two" }), user("c", { gitBranch: "" })]);
    expect(state.cwd).toBe("/first");
    expect(state.gitBranch).toBe("two");
  });
});

describe("foldConversationRecord: records that are wrong", () => {
  it("changes nothing for an unknown type, an empty record, or fields of the wrong type", () => {
    const { state, turns } = fold([
      { type: "from-the-future", anything: 1 },
      {},
      { type: "ai-title", aiTitle: 42 },
      { type: "pr-link", prNumber: "12", prUrl: "u" },
      { type: "pr-link", prNumber: 12 },
      { type: "cost-state", totalCostUSD: "1.0", totalLinesAdded: null },
      { cwd: 7, gitBranch: ["main"], timestamp: "not a date", attributionSkill: {}, hookErrors: "boom", isSidechain: "true" },
      { type: "user", message: null },
      { type: "user", message: { content: [null, 3, { type: "text" }] } },
      { type: "assistant", message: { content: "   " } },
    ]);
    expect(state).toEqual(emptyConversationState());
    expect(turns).toEqual([]);
  });

  it("does not let a later cost record without numbers erase the last good one", () => {
    expect(fold([{ type: "cost-state", totalCostUSD: 2 }, { type: "cost-state" }]).state.costUsd).toBe(2);
  });

  it("reads time only from an ISO timestamp", () => {
    expect(recordTime({ timestamp: "2026-11-18T08:00:00.000Z" })).toBe(Date.parse("2026-11-18T08:00:00.000Z"));
    expect(recordTime({ timestamp: 1795074973647 })).toBeNull();
    expect(recordTime({ timestamp: "" })).toBeNull();
    expect(recordTime({})).toBeNull();
  });

  it("reads a PR link only when it has a number and a url", () => {
    expect(prLinkOf({ prNumber: 3, prUrl: "https://x/3" })).toEqual({ number: 3, url: "https://x/3", repository: "" });
    expect(prLinkOf({ prNumber: Number.NaN, prUrl: "https://x/3" })).toBeNull();
    expect(prLinkOf({ prNumber: 3, prUrl: "   " })).toBeNull();
  });
});

describe("isConversationState", () => {
  const full = (): ConversationState =>
    fold([user("a", { cwd: "/w", timestamp: "2026-11-18T08:00:00.000Z" }), { type: "pr-link", prNumber: 1, prUrl: "u", prRepository: "o/r" }]).state;

  it("accepts what the fold produces, after a round trip through JSON", () => {
    expect(isConversationState(JSON.parse(JSON.stringify(full())))).toBe(true);
    expect(isConversationState(emptyConversationState())).toBe(true);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "state"],
    ["a missing field", (({ hookErrors: _omit, ...rest }) => rest)(emptyConversationState())],
    ["a wrong-typed title", { ...emptyConversationState(), aiTitle: 3 }],
    ["a wrong-typed number", { ...emptyConversationState(), costUsd: "1" }],
    ["a malformed PR", { ...emptyConversationState(), prs: [{ number: 1 }] }],
    ["a PR without a repository", { ...emptyConversationState(), prs: [{ number: 1, url: "u" }] }],
    ["a non-string skill", { ...emptyConversationState(), skills: [1] }],
    ["a non-boolean sidechain flag", { ...emptyConversationState(), isSidechain: 1 }],
  ])("rejects %s", (_label, value) => {
    expect(isConversationState(value)).toBe(false);
  });
});
