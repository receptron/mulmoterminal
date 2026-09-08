// @vitest-environment node
import { describe, it, expect } from "vitest";
import { codexUserTurn, codexUserPrompt, isDoubleWrite } from "../../../server/agents/codex-user-turn.js";

const eventMsg = (message: string): Record<string, unknown> => ({ type: "event_msg", payload: { type: "user_message", message } });
const responseItem = (...texts: string[]): Record<string, unknown> => ({
  type: "response_item",
  payload: { type: "message", role: "user", content: texts.map((text) => ({ type: "input_text", text })) },
});
// codex's preamble: ONE message carrying the plugin list, the repo's AGENTS.md and the environment
// context together. The AGENTS.md part has no tag of its own, so it only stays out if the whole
// message is skipped.
const preamble = (): Record<string, unknown> =>
  responseItem(
    "<recommended_plugins>\nAirtable (airtable@openai-curated-remote)\n</recommended_plugins>",
    "# AGENTS.md instructions for /work\n\n<INSTRUCTIONS>\nbe nice\n</INSTRUCTIONS>",
    "<environment_context>\n  <cwd>/work</cwd>\n</environment_context>",
  );

describe("codexUserTurn", () => {
  it("reads the shape codex wrote until 2026-08", () => {
    expect(codexUserTurn(eventMsg("fix the login bug"))).toEqual({ text: "fix the login bug", shape: "event_msg" });
  });
  it("reads the shape codex writes now", () => {
    expect(codexUserTurn(responseItem("fix the login bug"))).toEqual({ text: "fix the login bug", shape: "response_item" });
  });
  it("accepts a message whose content is a bare string", () => {
    const doc = { type: "response_item", payload: { type: "message", role: "user", content: "plain string content" } };
    expect(codexUserTurn(doc)?.text).toBe("plain string content");
  });
  it("trims", () => {
    expect(codexUserTurn(responseItem("  spaced  "))?.text).toBe("spaced");
  });

  it("skips the whole synthetic preamble, including its untagged AGENTS.md part", () => {
    expect(codexUserTurn(preamble())).toBeNull();
  });
  it.each(["environment_context", "recommended_plugins", "user_action", "turn_aborted"])("skips codex's own <%s> block", (tag) => {
    expect(codexUserTurn(responseItem(`<${tag}>\n  something\n</${tag}>`))).toBeNull();
  });
  // A person's prompt may open with markup, and treating that as codex's own would drop the turn.
  it.each(["<div>fix the login bug</div>", "<task> explain this file", "<foo/> and then some"])("keeps a real prompt that opens with markup: %s", (text) => {
    expect(codexUserTurn(responseItem(text))?.text).toBe(text);
  });
  it("keeps a multi-part prompt whose second part opens with an unknown tag", () => {
    expect(codexUserTurn(responseItem("explain this", "<foo>bar</foo>"))?.text).toBe("explain this");
  });

  it.each([
    ["an assistant message", { type: "response_item", payload: { type: "message", role: "assistant", content: [{ text: "hi" }] } }],
    ["a developer message", { type: "response_item", payload: { type: "message", role: "developer", content: [{ text: "<skills_instructions>x" }] } }],
    ["a reasoning item", { type: "response_item", payload: { type: "reasoning", content: [{ text: "thinking" }] } }],
    ["a user_message payload that is not an event_msg", { type: "response_item", payload: { type: "user_message", message: "no" } }],
    ["an event_msg of another type", { type: "event_msg", payload: { type: "agent_message", message: "no" } }],
    ["a message with no text parts", { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_image" }] } }],
    ["a message whose parts are all blank", { type: "response_item", payload: { type: "message", role: "user", content: [{ text: "   " }] } }],
    ["a payload that is not an object", { type: "response_item", payload: "x" }],
    ["a record with no payload", { type: "response_item" }],
    ["an empty record", {}],
  ])("returns null for %s", (_label, doc) => {
    expect(codexUserTurn(doc as Record<string, unknown>)).toBeNull();
  });
});

describe("codexUserPrompt", () => {
  it("is the turn's text", () => {
    expect(codexUserPrompt(responseItem("hello"))).toBe("hello");
  });
  it("is null when there is no turn", () => {
    expect(codexUserPrompt(preamble())).toBeNull();
  });
});

describe("isDoubleWrite", () => {
  // 924 pairs measured in the store, every one of them a response_item followed IMMEDIATELY by an
  // event_msg carrying the identical text.
  const asTurn = (doc: Record<string, unknown>) => {
    const turn = codexUserTurn(doc);
    if (turn === null) throw new Error("fixture is not a user turn");
    return turn;
  };
  it("recognises the event_msg half of a pair", () => {
    expect(isDoubleWrite(asTurn(eventMsg("same text")), asTurn(responseItem("same text")))).toBe(true);
  });
  it("does not drop the response_item half", () => {
    expect(isDoubleWrite(asTurn(responseItem("same text")), asTurn(eventMsg("same text")))).toBe(false);
  });
  // 28 prompts in the store exist ONLY as an event_msg; dropping those would lose them.
  it("keeps an event_msg with no response_item before it", () => {
    expect(isDoubleWrite(asTurn(eventMsg("only shape")), null)).toBe(false);
  });
  it("keeps an event_msg whose predecessor said something else", () => {
    expect(isDoubleWrite(asTurn(eventMsg("second")), asTurn(responseItem("first")))).toBe(false);
  });
  // A person who really did send the same text twice sends it in ONE shape both times.
  it("keeps a repeated prompt in the same shape", () => {
    expect(isDoubleWrite(asTurn(responseItem("続けて")), asTurn(responseItem("続けて")))).toBe(false);
  });
});
