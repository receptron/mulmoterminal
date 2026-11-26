// @vitest-environment node
import { describe, it, expect } from "vitest";
import { continuesTurn, emptyTurnBoundary, isTurnBoundaryState, opensTurn } from "../../../../server/session/transcript/turn-boundary.js";
import {
  conversationTurnsFromParsed,
  currentTurnToolNamesFromParsed,
  latestUserPromptFromParsed,
  turnOpeningPrompt,
} from "../../../../server/session/transcript/transcript.js";
import { lastTurnFromClaudeParsed } from "../../../../server/session/transcript/last-turn.js";
import { transcriptPrompts } from "../../../../server/session/transcript/prompt-history.js";
import { copySummaryState, emptySummaryState, foldSummary, summaryPartsOf } from "../../../../server/session/transcript/summary-scan.js";
import { emptyTranscriptScan, foldTranscriptView, transcriptViewOf } from "../../../../server/session/transcript/transcript-view.js";
import { emptyConversationState, foldConversationRecord } from "../../../../server/backends/library/conversation-fold.js";

type JsonRecord = Record<string, unknown>;

const RESPONSE_MAX = 500;
const SKILL_BODY = "Base directory for this skill: /home/u/.claude/skills/clone-as\n\n# clone-as\nDo the thing.";
const IMAGE_NOTE = "[Image: source: /tmp/shot.png]";

const typed = (text: string, promptId?: string): JsonRecord => ({
  type: "user",
  timestamp: "2026-11-26T00:00:00.000Z",
  ...(promptId === undefined ? {} : { promptId }),
  message: { role: "user", content: text },
});
const meta = (text: string, promptId?: string, extra: JsonRecord = {}): JsonRecord => ({
  ...typed("", promptId),
  isMeta: true,
  ...extra,
  message: { role: "user", content: [{ type: "text", text }] },
});
const toolUse = (name: string): JsonRecord => ({
  type: "assistant",
  message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: `toolu_${name}`, name, input: {} }] },
});
const toolResult = (promptId?: string): JsonRecord => ({
  type: "user",
  ...(promptId === undefined ? {} : { promptId }),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "ok" }] },
});
const reply = (text: string): JsonRecord => ({
  type: "assistant",
  message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text }] },
});

// prompt -> Skill -> its body -> Bash -> answer, then another session's message opens the next turn.
const skillTurn = (id: string | undefined): JsonRecord[] => [
  typed("clone this repo as foo", id),
  toolUse("Skill"),
  toolResult(id),
  meta(SKILL_BODY, id, { sourceToolUseID: "toolu_Skill" }),
  toolUse("Bash"),
  toolResult(id),
  reply("cloned"),
];
const peerTurn: JsonRecord[] = [meta("Another Claude session sent a message: review PR 1", "p2", { origin: { kind: "peer" } }), reply("reviewed")];
const transcript = [...skillTurn("p1"), ...peerTurn];

describe("opensTurn", () => {
  it("a meta record opens on a new promptId and not on the one already open", () => {
    const state = emptyTurnBoundary();
    expect(opensTurn(state, { isMeta: true, promptId: "a" })).toBe(true);
    expect(opensTurn(state, { isMeta: true, promptId: "a" })).toBe(false);
    expect(opensTurn(state, { isMeta: true, promptId: "b" })).toBe(true);
    expect(opensTurn(state, { isMeta: true, promptId: "a" })).toBe(true);
  });

  it("a meta record with no usable promptId opens nothing and leaves the open id alone", () => {
    const state = emptyTurnBoundary();
    opensTurn(state, { promptId: "a" });
    [{ isMeta: true }, { isMeta: true, promptId: "" }, { isMeta: true, promptId: 7 }, { isMeta: true, promptId: null }].forEach((record) =>
      expect(opensTurn(state, record)).toBe(false),
    );
    expect(opensTurn(state, { isMeta: true, promptId: "a" })).toBe(false);
  });

  it("a typed record always opens, whatever its promptId", () => {
    const state = emptyTurnBoundary();
    [{}, { promptId: "" }, { promptId: 7 }, { promptId: "a" }, { promptId: "a" }, { isMeta: false, promptId: "a" }, { isMeta: "true", promptId: "a" }].forEach(
      (record) => expect(opensTurn(state, record)).toBe(true),
    );
  });

  it("a typed prompt sharing the id of a resume's meta record still opens a turn (Claude Desktop)", () => {
    const state = emptyTurnBoundary();
    expect(opensTurn(state, { isMeta: true, promptId: "r" })).toBe(true);
    expect(opensTurn(state, { promptId: "r", origin: { kind: "human" } })).toBe(true);
    expect(opensTurn(state, { isMeta: true, promptId: "r" })).toBe(false);
  });

  it("a typed record takes the id, so a meta record under it is the same turn", () => {
    const state = emptyTurnBoundary();
    opensTurn(state, { promptId: "a" });
    expect(opensTurn(state, { isMeta: true, promptId: "a" })).toBe(false);
    opensTurn(state, {});
    expect(opensTurn(state, { isMeta: true, promptId: "a" })).toBe(true);
  });
});

describe("continuesTurn", () => {
  it("takes the id as the open turn's, so a meta record under it is the same turn", () => {
    const state = emptyTurnBoundary();
    continuesTurn(state, { promptId: "a" });
    expect(opensTurn(state, { isMeta: true, promptId: "a" })).toBe(false);
  });

  it("leaves the open id alone for a record without a usable one", () => {
    [{}, { promptId: "" }, { promptId: 3 }].forEach((record) => {
      const state = emptyTurnBoundary();
      opensTurn(state, { promptId: "a" });
      continuesTurn(state, record);
      expect(state.openPromptId).toBe("a");
    });
  });
});

describe("isTurnBoundaryState", () => {
  it("accepts what the fold writes and nothing else", () => {
    expect(isTurnBoundaryState({ openPromptId: null })).toBe(true);
    expect(isTurnBoundaryState({ openPromptId: "a" })).toBe(true);
    [undefined, null, "a", [], {}, { openPromptId: 1 }, { openPromptId: undefined }].forEach((value) => expect(isTurnBoundaryState(value)).toBe(false));
  });
});

describe("turnOpeningPrompt", () => {
  it("a harness tag does not claim the id, so the typed prompt under it still opens the turn", () => {
    const state = emptyTurnBoundary();
    expect(turnOpeningPrompt(state, typed("<local-command-caveat>x</local-command-caveat>", "a"))).toBeNull();
    expect(turnOpeningPrompt(state, typed("fix it", "a"))).toBe("fix it");
  });

  it("a tool result never opens a turn, and teaches the open turn's id", () => {
    const state = emptyTurnBoundary();
    expect(turnOpeningPrompt(state, toolResult("a"))).toBeNull();
    expect(turnOpeningPrompt(state, meta(SKILL_BODY, "a"))).toBeNull();
    expect(turnOpeningPrompt(state, typed("fix it", "a"))).toBe("fix it");
  });

  it("a tagged record does not teach its id: a slash command's expansion still opens its turn", () => {
    const state = emptyTurnBoundary();
    turnOpeningPrompt(state, typed("first", "p0"));
    expect(turnOpeningPrompt(state, typed("<command-name>/clone-as</command-name>", "p1"))).toBeNull();
    expect(turnOpeningPrompt(state, meta(SKILL_BODY, "p1"))).toBe(SKILL_BODY);
  });

  it("is null for anything that is not a user record", () => {
    [reply("hi"), { type: "summary" }, {}, { type: "user" }, { type: "user", message: null }].forEach((record) =>
      expect(turnOpeningPrompt(emptyTurnBoundary(), record)).toBeNull(),
    );
  });
});

describe("a skill's body is not a prompt (#3546)", () => {
  it("keeps the turn whole in the conversation turns", () => {
    const users = conversationTurnsFromParsed(transcript).filter((turn) => turn.role === "user");
    expect(users.map((turn) => turn.text)).toEqual(["clone this repo as foo", "Another Claude session sent a message: review PR 1"]);
  });

  it("leaves the typed prompt as the latest one, and the turn's tools uncut, mid-turn", () => {
    const midTurn = skillTurn("p1").slice(0, 5);
    expect(latestUserPromptFromParsed(midTurn)).toBe("clone this repo as foo");
    expect(currentTurnToolNamesFromParsed(midTurn)).toEqual(["Skill", "Bash"]);
  });

  it("pairs the answer with the prompt typed", () => {
    expect(lastTurnFromClaudeParsed(skillTurn("p1"))).toEqual({ prompt: "clone this repo as foo", reply: "cloned" });
    expect(lastTurnFromClaudeParsed(transcript)).toEqual({ prompt: "Another Claude session sent a message: review PR 1", reply: "reviewed" });
  });

  it("an image note does not stand in for the prompt it follows", () => {
    const records = [typed("what is wrong here", "p1"), toolUse("Read"), toolResult("p1"), meta(IMAGE_NOTE, "p1")];
    expect(latestUserPromptFromParsed(records)).toBe("what is wrong here");
  });

  it("lists only the prompts in the transcript fallback of the prompt history", () => {
    expect(transcriptPrompts(transcript).map((entry) => entry.text)).toEqual(["clone this repo as foo", "Another Claude session sent a message: review PR 1"]);
  });

  it("the summary fold counts two turns and resumes to the same answer from any record", () => {
    const whole = emptySummaryState();
    transcript.forEach((record) => foldSummary(whole, record));
    const parts = summaryPartsOf(whole, RESPONSE_MAX);
    expect(parts.userTurns).toBe(2);
    expect(parts.lastPrompt).toBe("Another Claude session sent a message: review PR 1");
    transcript.forEach((_, cut) => {
      const head = emptySummaryState();
      transcript.slice(0, cut).forEach((record) => foldSummary(head, record));
      const resumed = JSON.parse(JSON.stringify(copySummaryState(head)));
      transcript.slice(cut).forEach((record) => foldSummary(resumed, record));
      expect(summaryPartsOf(resumed, RESPONSE_MAX), `cut ${cut}`).toEqual(parts);
    });
  });

  it("the summary's tool names keep the Skill call mid-turn", () => {
    const state = emptySummaryState();
    skillTurn("p1")
      .slice(0, 5)
      .forEach((record) => foldSummary(state, record));
    expect(summaryPartsOf(state, RESPONSE_MAX).toolNames).toEqual(["Skill", "Bash"]);
  });

  it("the conversation view shows one turn without the skill's body, and the peer message as the next", () => {
    const scan = emptyTranscriptScan();
    const boundary = emptyTurnBoundary();
    transcript.forEach((record) => foldTranscriptView(scan, record, boundary));
    const view = transcriptViewOf(scan, false);
    if (view.status !== "ok") throw new Error(`expected turns, got ${view.status}`);
    expect(view.turns).toHaveLength(2);
    const texts = view.turns.flatMap((turn) => turn.rows.map((row) => row.text));
    expect(texts.some((text) => text.includes("Base directory for this skill"))).toBe(false);
    expect(view.turns[0]?.rows[0]).toMatchObject({ kind: "user", text: "clone this repo as foo" });
    expect(view.turns[1]?.rows[0]?.text).toContain("Another Claude session sent a message");
  });

  it("the Library indexes the two prompts, keeping a message from another session", () => {
    const state = emptyConversationState();
    const users = transcript.flatMap((record) => foldConversationRecord(state, record) ?? []).filter((turn) => turn.role === "user");
    expect(users.map((turn) => turn.text)).toEqual(["clone this repo as foo", "Another Claude session sent a message: review PR 1"]);
    expect(state.userTurns).toBe(2);
  });

  it("a window that opens mid-turn, at the Skill call or its result, keeps the body out", () => {
    const whole = skillTurn("p1");
    [1, 2].forEach((from) => {
      const users = conversationTurnsFromParsed(whole.slice(from)).filter((turn) => turn.role === "user");
      expect(users, `from ${from}`).toEqual([]);
      expect(latestUserPromptFromParsed(whole.slice(from)), `from ${from}`).toBeNull();
    });
  });

  it("a window that opens exactly at the body still reads it as a prompt: nothing before it says otherwise", () => {
    const users = conversationTurnsFromParsed(skillTurn("p1").slice(3)).filter((turn) => turn.role === "user");
    expect(users.map((turn) => turn.text)).toEqual([SKILL_BODY]);
  });

  it("a transcript with no promptId still keeps a meta skill body out", () => {
    const users = conversationTurnsFromParsed(skillTurn(undefined)).filter((turn) => turn.role === "user");
    expect(users.map((turn) => turn.text)).toEqual(["clone this repo as foo"]);
  });

  it("a transcript with no promptId opens a turn on every typed prompt, as before the rule", () => {
    const users = conversationTurnsFromParsed([typed("one"), reply("a"), typed("two"), typed("three")]).filter((turn) => turn.role === "user");
    expect(users.map((turn) => turn.text)).toEqual(["one", "two", "three"]);
  });
});
