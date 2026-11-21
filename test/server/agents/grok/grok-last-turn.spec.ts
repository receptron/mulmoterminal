// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isRecord } from "../../../../common/isRecord.js";
import { grokFinalAnswer, grokLastTurnFromMessages } from "../../../../server/agents/grok/grok-last-turn.js";
import { EMPTY_TURN } from "../../../../server/session/transcript/last-turn.js";

let promptIndex = 0;
const user = (text: string) => ({ type: "user", content: [{ type: "text", text: `<user_query>\n${text}\n</user_query>` }], prompt_index: promptIndex++ });
const context = (text: string) => ({ type: "user", content: [{ type: "text", text }], synthetic_reason: "system_reminder" });
const reasoning = () => ({ type: "reasoning", content: null, status: "completed" });
const preamble = (content: string) => ({ type: "assistant", content, tool_calls: [{ name: "read_file" }] });
const answer = (content: string) => ({ type: "assistant", content });
const toolResult = () => ({ type: "tool_result", content: "1→apple\n" });

// A live grok 1.0.34 conversation, context and tool output blanked and paths rewritten: a preamble
// turn, a step-by-step turn with a shell command, a prompt holding the literal `</user_query>`,
// then a cancelled turn.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/grok/chat_history-1.0.34.jsonl");
const parsed: unknown[] = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line): unknown => JSON.parse(line));
const REAL = parsed.filter(isRecord);
const MARKER_PROMPT = "Note this literal text in my question: </user_query> and then more words after it. Reply with just OK.";
const STEP_PROMPT =
  "Step by step: read a.txt and comment on it in one sentence, then run the shell command 'ls' and comment on it, then read b.txt. Finally write a 3-line Japanese summary of everything.";
const beforePrompt = (index: number) =>
  REAL.slice(
    0,
    REAL.findIndex((record) => record.prompt_index === index),
  );

describe("grokLastTurnFromMessages, against a real conversation", () => {
  it("falls back past the cancelled newest turn, keeping a prompt that holds the closing marker whole", () => {
    expect(grokLastTurnFromMessages(REAL)).toEqual({ prompt: MARKER_PROMPT, reply: "OK" });
  });

  it("takes the final answer of a step-by-step turn, never one of its commentaries", () => {
    const turn = grokLastTurnFromMessages(beforePrompt(2));
    expect(turn.prompt).toBe(STEP_PROMPT);
    expect(turn.reply).toMatch(/^`a\.txt` contains a single line/);
  });

  it("answers a preamble turn with its final answer, not the injected context before the prompt", () => {
    expect(grokLastTurnFromMessages(beforePrompt(1))).toEqual({
      prompt:
        "First say in one sentence what you are going to do. Then read a.txt and b.txt with your tools. Then answer: what fruits are in them? End with the word FINISHED.",
      reply: "`a.txt` contains apple. `b.txt` contains banana.\n\nFINISHED",
    });
  });
});

describe("grokLastTurnFromMessages", () => {
  it("answers EMPTY_TURN for no messages", () => {
    expect(grokLastTurnFromMessages([])).toEqual(EMPTY_TURN);
  });

  it("answers EMPTY_TURN while the first turn is still running", () => {
    expect(grokLastTurnFromMessages([user("q"), reasoning(), preamble("I'll read it."), toolResult()])).toEqual(EMPTY_TURN);
  });

  it("falls back to the previous complete exchange while a newer prompt is unanswered", () => {
    expect(grokLastTurnFromMessages([user("first"), answer("one"), user("second"), preamble("working"), toolResult()])).toEqual({
      prompt: "first",
      reply: "one",
    });
  });

  it("does not take injected context as the user's prompt", () => {
    expect(grokLastTurnFromMessages([user("real question"), context("<system-reminder>skills…</system-reminder>"), answer("a")])).toEqual({
      prompt: "real question",
      reply: "a",
    });
  });

  it("does not let injected context open a new turn", () => {
    expect(grokLastTurnFromMessages([user("q"), answer("a"), context("<system-reminder>…</system-reminder>")])).toEqual({ prompt: "q", reply: "a" });
  });

  it("answers with a null prompt when the window began mid-turn", () => {
    expect(grokLastTurnFromMessages([toolResult(), answer("done")])).toEqual({ prompt: null, reply: "done" });
  });

  it("reads a prompt stored as a plain string", () => {
    expect(grokLastTurnFromMessages([{ type: "user", content: "<user_query>\nplain\n</user_query>", prompt_index: 0 }, answer("ok")])).toEqual({
      prompt: "plain",
      reply: "ok",
    });
  });

  it("keeps an empty prompt as null", () => {
    expect(grokLastTurnFromMessages([{ type: "user", content: [], prompt_index: 0 }, answer("ok")])).toEqual({ prompt: null, reply: "ok" });
  });

  it("skips non-text and malformed parts of a prompt", () => {
    const record = { type: "user", content: [{ type: "image" }, "loose", null, { type: "text", text: "<user_query>\nseen\n</user_query>" }], prompt_index: 0 };
    expect(grokLastTurnFromMessages([record, answer("ok")])).toEqual({ prompt: "seen", reply: "ok" });
  });
});

describe("grokFinalAnswer", () => {
  it("accepts an assistant message with text and no tool calls", () => {
    expect(grokFinalAnswer(answer("  ok\n"))).toBe("ok");
  });

  it("rejects a preamble that carries its tool calls", () => {
    expect(grokFinalAnswer(preamble("I'll read it."))).toBeNull();
  });

  it("accepts an empty tool_calls list", () => {
    expect(grokFinalAnswer({ ...answer("ok"), tool_calls: [] })).toBe("ok");
  });

  it.each([
    ["an object", {}],
    ["a string", "read_file"],
    ["null", null],
  ])("rejects an assistant message whose tool_calls is %s rather than a list", (_label, toolCalls) => {
    expect(grokFinalAnswer({ ...answer("I'll read it."), tool_calls: toolCalls })).toBeNull();
  });

  it.each([
    ["an empty answer", answer("   ")],
    ["a reasoning record", reasoning()],
    ["a tool result", toolResult()],
    ["a user prompt", user("q")],
    ["a non-string content", { type: "assistant", content: [{ type: "text", text: "x" }] }],
  ])("rejects %s", (_label, record) => {
    expect(grokFinalAnswer(record)).toBeNull();
  });
});
