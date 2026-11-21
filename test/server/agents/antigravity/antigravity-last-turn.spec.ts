// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isRecord } from "../../../../common/isRecord.js";
import {
  antigravityCurrentTurnReplyFromSteps,
  antigravityFinalAnswer,
  antigravityLastTurnFromSteps,
} from "../../../../server/agents/antigravity/antigravity-last-turn.js";
import { EMPTY_TURN } from "../../../../server/session/transcript/last-turn.js";

const wrap = (text: string) =>
  `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-21T12:36:28+09:00.\n</ADDITIONAL_METADATA>`;
const user = (text: string) => ({ source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: wrap(text) });
const preamble = (content: string | null) => ({ source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content, tool_calls: [{ name: "read_file" }] });
const answer = (content: string) => ({ source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content });
const toolOutput = () => ({ source: "MODEL", type: "GENERIC", status: "DONE", content: "(tool output)" });
const interrupted = () => ({ source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: null });

// A live agy 1.3.5 session, tool outputs blanked and paths rewritten: a preamble turn, a step-by-step
// turn with two commentaries and a shell command, then an interrupted turn.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/antigravity/transcript-1.3.5.jsonl");
const parsed: unknown[] = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line): unknown => JSON.parse(line));
const REAL = parsed.filter(isRecord);
const upTo = (stepIndex: number) => REAL.filter((record) => typeof record.step_index === "number" && record.step_index <= stepIndex);

describe("antigravityLastTurnFromSteps, against a real session", () => {
  it("falls back past the interrupted newest turn to the step-by-step one, taking its final answer", () => {
    const turn = antigravityLastTurnFromSteps(REAL);
    expect(turn.prompt).toBe(
      "Step by step: read a.txt and comment on it in one sentence, then run the shell command 'ls' and comment on it, then read b.txt. Finally write a 3-line Japanese summary of everything.",
    );
    expect(turn.reply).toMatch(/^\[a\.txt\]\(file:\/\/\/work\/probe\/a\.txt\) を確認したところ/);
  });

  it("answers a preamble turn with its final answer, not the preamble", () => {
    const turn = antigravityLastTurnFromSteps(upTo(4));
    expect(turn.prompt).toBe(
      "First say in one sentence what you are going to do. Then read a.txt and b.txt with your tools. Then answer: what fruits are in them? End with the word FINISHED.",
    );
    expect(turn.reply).toMatch(/^The fruits found in the files are:/);
    expect(turn.reply).toMatch(/FINISHED$/);
  });

  it("answers the previous turn while the step-by-step turn is between its commentaries", () => {
    expect(antigravityLastTurnFromSteps(upTo(10)).reply).toMatch(/^The fruits found/);
  });
});

describe("antigravityCurrentTurnReplyFromSteps, against a real session", () => {
  it("answers null for the interrupted newest turn", () => {
    expect(antigravityCurrentTurnReplyFromSteps(REAL)).toBeNull();
  });

  it("answers the newest turn's reply when it finished", () => {
    expect(antigravityCurrentTurnReplyFromSteps(upTo(12))).toMatch(/を確認したところ/);
  });
});

describe("antigravityLastTurnFromSteps", () => {
  it("answers EMPTY_TURN for no steps", () => {
    expect(antigravityLastTurnFromSteps([])).toEqual(EMPTY_TURN);
  });

  it("answers EMPTY_TURN while the first turn is still running", () => {
    expect(antigravityLastTurnFromSteps([user("q"), preamble("I will look."), toolOutput()])).toEqual(EMPTY_TURN);
  });

  it("does not take an interrupt's empty response as an answer", () => {
    expect(antigravityLastTurnFromSteps([user("first"), answer("one"), user("second"), preamble(null), interrupted()])).toEqual({
      prompt: "first",
      reply: "one",
    });
  });

  it("unwraps the prompt agy stores", () => {
    expect(antigravityLastTurnFromSteps([user("what is this"), answer("a repo")])).toEqual({ prompt: "what is this", reply: "a repo" });
  });

  it("answers with a null prompt when the window began mid-turn", () => {
    expect(antigravityLastTurnFromSteps([toolOutput(), answer("done")])).toEqual({ prompt: null, reply: "done" });
  });

  it("keeps a prompt with no content as null", () => {
    expect(antigravityLastTurnFromSteps([{ type: "USER_INPUT", status: "DONE" }, answer("ok")])).toEqual({ prompt: null, reply: "ok" });
  });

  it("ignores system steps between the prompt and the answer", () => {
    const steps = [
      user("q"),
      { source: "SYSTEM", type: "CONVERSATION_HISTORY", status: "DONE" },
      { source: "SYSTEM", type: "CHECKPOINT", status: "DONE", content: "{{ CHECKPOINT 0 }}" },
      answer("a"),
    ];
    expect(antigravityLastTurnFromSteps(steps)).toEqual({ prompt: "q", reply: "a" });
  });
});

describe("antigravityCurrentTurnReplyFromSteps", () => {
  it("answers null for no steps", () => {
    expect(antigravityCurrentTurnReplyFromSteps([])).toBeNull();
  });

  it("answers null when the newest prompt has no answer yet, whatever came before", () => {
    expect(antigravityCurrentTurnReplyFromSteps([user("first"), answer("one"), user("second")])).toBeNull();
  });

  it("answers null for an interrupted turn", () => {
    expect(antigravityCurrentTurnReplyFromSteps([user("first"), answer("one"), user("second"), interrupted()])).toBeNull();
  });
});

describe("antigravityFinalAnswer", () => {
  it("accepts a response with text and no tool calls", () => {
    expect(antigravityFinalAnswer(answer("  ok\n"))).toBe("ok");
  });

  it("rejects a preamble that carries its tool calls", () => {
    expect(antigravityFinalAnswer(preamble("I will read it."))).toBeNull();
  });

  it("accepts a response whose tool_calls is an empty list", () => {
    expect(antigravityFinalAnswer({ ...answer("ok"), tool_calls: [] })).toBe("ok");
  });

  it("rejects a response that is not DONE", () => {
    expect(antigravityFinalAnswer({ ...answer("partial"), status: "RUNNING" })).toBeNull();
  });

  it.each([
    ["an interrupt's empty response", interrupted()],
    ["whitespace only", answer("   ")],
    ["a tool output", toolOutput()],
    ["a user prompt", user("q")],
    ["a non-string content", { type: "PLANNER_RESPONSE", status: "DONE", content: { text: "x" } }],
  ])("rejects %s", (_label, record) => {
    expect(antigravityFinalAnswer(record)).toBeNull();
  });
});
