// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { copilotCurrentTurnReplyFromEvents, copilotFinalAnswer, copilotLastTurnFromEvents } from "../../../../server/agents/copilot/copilot-last-turn.js";
import { isRecord } from "../../../../common/isRecord.js";
import { EMPTY_TURN } from "../../../../server/session/transcript/last-turn.js";

const user = (content: unknown) => ({ type: "user.message", data: { content } });
const preamble = (content: string) => ({ type: "assistant.message", data: { phase: "commentary", content, toolRequests: [{ name: "view" }] } });
const toolOnly = () => ({ type: "assistant.message", data: { content: "", toolRequests: [{ name: "bash" }] } });
const answer = (content: string) => ({ type: "assistant.message", data: { phase: "final_answer", content, toolRequests: [] } });
const SUBAGENT = { agentId: "b0c9cda9-5ed5-4ec8-b56d-bcb55525e52f" };
const abort = () => ({ type: "abort", data: { reason: "user_initiated" } });

// A live copilot 1.0.83 session, cut down to the fields the reader looks at: a turn with a preamble,
// a plain one, a step-by-step turn with two commentaries, a subagent turn, then an interrupted one.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/copilot/events-1.0.83.jsonl");
const parsed: unknown[] = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line): unknown => JSON.parse(line));
const REAL = parsed.filter(isRecord);
const SUBAGENT_PROMPT = "Use a subagent (task tool) to count the lines in a.txt and b.txt, then tell me the total.";
const before = (prompt: string) =>
  REAL.slice(
    0,
    REAL.findIndex((record) => isRecord(record.data) && record.data.content === prompt),
  );
const ESSAY = "Write a 2000-word essay about fruit, reading a.txt and b.txt first.";

describe("copilotLastTurnFromEvents, against a real session", () => {
  it("answers the subagent turn, quoting the user's prompt rather than the subagent's", () => {
    // The newest interaction was interrupted, so the one before it is the last complete exchange.
    expect(copilotLastTurnFromEvents(REAL)).toEqual({ prompt: SUBAGENT_PROMPT, reply: "The total is 2 lines." });
  });

  it("takes the final answer of a step-by-step turn, never one of its commentaries", () => {
    const turn = copilotLastTurnFromEvents(before(SUBAGENT_PROMPT));
    expect(turn.reply).toMatch(/^a\.txtには「apple」と書かれています。\nls/);
    expect(turn.prompt).toMatch(/^Step by step:/);
  });

  it("answers a preamble turn with its final answer", () => {
    expect(copilotLastTurnFromEvents(before("Now just reply with the single word SECOND."))).toEqual({
      prompt:
        "First say in one sentence what you are going to do. Then read a.txt and b.txt with your tools. Then answer: what fruits are in them? End with the word FINISHED.",
      reply: "The fruits are apple and banana. FINISHED",
    });
  });
});

describe("copilotCurrentTurnReplyFromEvents, against a real session", () => {
  it("answers null for the interrupted newest turn, not the previous turn's reply", () => {
    expect(copilotCurrentTurnReplyFromEvents(REAL)).toBeNull();
  });

  it("answers the newest turn's reply when it finished", () => {
    expect(copilotCurrentTurnReplyFromEvents(before(ESSAY))).toBe("The total is 2 lines.");
  });
});

describe("copilotLastTurnFromEvents", () => {
  it("answers EMPTY_TURN for no records", () => {
    expect(copilotLastTurnFromEvents([])).toEqual(EMPTY_TURN);
  });

  it("answers EMPTY_TURN while the first turn is still running", () => {
    expect(copilotLastTurnFromEvents([user("q"), preamble("I'll look."), toolOnly()])).toEqual(EMPTY_TURN);
  });

  it("falls back to the previous complete exchange while a newer prompt is unanswered", () => {
    expect(copilotLastTurnFromEvents([user("first"), answer("one"), user("second"), preamble("working")])).toEqual({ prompt: "first", reply: "one" });
  });

  it("falls back past an interrupted turn", () => {
    expect(copilotLastTurnFromEvents([user("first"), answer("one"), user("second"), preamble("working"), abort()])).toEqual({ prompt: "first", reply: "one" });
  });

  it("skips every record a subagent wrote, prompt and answer alike", () => {
    const records = [
      user("count them"),
      toolOnly(),
      { ...user("internal instructions"), ...SUBAGENT },
      { ...answer("internal result"), ...SUBAGENT },
      answer("2 lines"),
    ];
    expect(copilotLastTurnFromEvents(records)).toEqual({ prompt: "count them", reply: "2 lines" });
  });

  it("does not take a subagent's answer as the reply of a turn the main agent has not finished", () => {
    const records = [user("count them"), toolOnly(), { ...answer("internal result"), ...SUBAGENT }];
    expect(copilotLastTurnFromEvents(records)).toEqual(EMPTY_TURN);
  });

  it("answers with a null prompt when the window began mid-turn", () => {
    expect(copilotLastTurnFromEvents([preamble("reading"), answer("done")])).toEqual({ prompt: null, reply: "done" });
  });

  it("keeps an empty prompt as null rather than an empty string", () => {
    expect(copilotLastTurnFromEvents([user("   "), answer("ok")])).toEqual({ prompt: null, reply: "ok" });
  });

  it("does not let a non-string prompt through", () => {
    expect(copilotLastTurnFromEvents([user({ text: "x" }), answer("ok")])).toEqual({ prompt: null, reply: "ok" });
  });

  it("trims the reply", () => {
    expect(copilotLastTurnFromEvents([user("q"), answer("  ok\n")])).toEqual({ prompt: "q", reply: "ok" });
  });
});

describe("copilotCurrentTurnReplyFromEvents", () => {
  it("answers null for no records", () => {
    expect(copilotCurrentTurnReplyFromEvents([])).toBeNull();
  });

  it("answers null when the newest prompt has no answer yet, whatever came before", () => {
    expect(copilotCurrentTurnReplyFromEvents([user("first"), answer("one"), user("second")])).toBeNull();
  });

  it("ignores a subagent's answer", () => {
    expect(copilotCurrentTurnReplyFromEvents([user("q"), { ...answer("internal"), ...SUBAGENT }])).toBeNull();
  });

  it("does not let a subagent's prompt clear the turn's answer", () => {
    expect(copilotCurrentTurnReplyFromEvents([user("q"), answer("done"), { ...user("internal"), ...SUBAGENT }])).toBe("done");
  });
});

describe("copilotFinalAnswer", () => {
  it("accepts a final answer", () => {
    expect(copilotFinalAnswer(answer("ok"))).toBe("ok");
  });

  it("rejects a commentary preamble", () => {
    expect(copilotFinalAnswer(preamble("I'll read it."))).toBeNull();
  });

  it("rejects a record with no phase, even when it carries prose and no tools", () => {
    expect(copilotFinalAnswer({ type: "assistant.message", data: { content: "maybe", toolRequests: [] } })).toBeNull();
  });

  it("rejects a final answer that still requests tools", () => {
    expect(copilotFinalAnswer({ type: "assistant.message", data: { phase: "final_answer", content: "x", toolRequests: [{ name: "bash" }] } })).toBeNull();
  });

  it("accepts a final answer whose toolRequests field is absent", () => {
    expect(copilotFinalAnswer({ type: "assistant.message", data: { phase: "final_answer", content: "x" } })).toBe("x");
  });

  it("rejects an empty final answer", () => {
    expect(copilotFinalAnswer(answer("   "))).toBeNull();
  });

  it.each([
    ["another type", { type: "user.message", data: { phase: "final_answer", content: "x" } }],
    ["no data", { type: "assistant.message" }],
    ["data that is not an object", { type: "assistant.message", data: "final_answer" }],
    ["a non-string content", { type: "assistant.message", data: { phase: "final_answer", content: ["x"] } }],
  ])("rejects %s", (_label, record) => {
    expect(copilotFinalAnswer(record)).toBeNull();
  });
});
