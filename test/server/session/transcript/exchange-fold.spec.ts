import { describe, it, expect } from "vitest";
import { type ExchangeReader, hasToolList, lastCompleteExchange, newestPromptReply } from "../../../../server/session/transcript/exchange-fold.js";
import { proseThenCallRows, toolCallRow, unknownRow } from "../../../../server/session/transcript/transcript-view.js";
import { EMPTY_TURN } from "../../../../server/session/transcript/last-turn.js";
import { seededRandom } from "../../../helpers/seededRandom.js";

const READER: ExchangeReader = {
  isPrompt: (record) => record.type === "q",
  promptOf: (record) => (typeof record.text === "string" ? record.text : null),
  finalAnswer: (record) => (record.type === "a" && typeof record.text === "string" ? record.text : null),
};
const q = (text: string) => ({ type: "q", text });
const a = (text: string) => ({ type: "a", text });
const noise: { type: string; text?: string } = { type: "tool" };

describe("hasToolList", () => {
  it("treats absent and an empty list as no tools", () => {
    expect(hasToolList(undefined)).toBe(false);
    expect(hasToolList([])).toBe(false);
  });
  it("treats a non-empty list or any other shape as tools, so a malformed record is never an answer", () => {
    for (const value of [[1], null, "", 0, {}, "x"]) expect(hasToolList(value)).toBe(true);
  });
});

describe("lastCompleteExchange", () => {
  it("is empty for no records or prompts with no answer", () => {
    expect(lastCompleteExchange([], READER)).toEqual(EMPTY_TURN);
    expect(lastCompleteExchange([q("1"), noise], READER)).toEqual(EMPTY_TURN);
  });
  it("pairs the newest answered prompt with its last answer", () => {
    expect(lastCompleteExchange([q("1"), a("x"), noise, a("y")], READER)).toEqual({ prompt: "1", reply: "y" });
  });
  it("falls back to the previous exchange while the newest prompt is unanswered", () => {
    expect(lastCompleteExchange([q("1"), a("x"), q("2"), noise], READER)).toEqual({ prompt: "1", reply: "x" });
  });
  it("keeps a null prompt for an answer that precedes any prompt", () => {
    expect(lastCompleteExchange([a("x")], READER)).toEqual({ prompt: null, reply: "x" });
  });
});

describe("newestPromptReply", () => {
  it("is null with nothing, and null again once a new prompt arrives", () => {
    expect(newestPromptReply([], READER)).toBeNull();
    expect(newestPromptReply([q("1"), a("x"), q("2")], READER)).toBeNull();
  });
  it("is the last answer after the newest prompt", () => {
    expect(newestPromptReply([q("1"), a("x"), noise, a("y"), noise], READER)).toBe("y");
  });
  it("never answers an older exchange: over generated logs it is the reply of the last exchange only when that exchange is the newest prompt's", () => {
    const random = seededRandom(3542);
    Array.from({ length: 500 }).forEach(() => {
      const records = Array.from({ length: random.below(12) }, () => random.pick([q("p"), a("r1"), a("r2"), noise]));
      const lastPrompt = records.map((record) => record.type).lastIndexOf("q");
      const after = records.slice(lastPrompt + 1).filter((record) => record.type === "a");
      expect(newestPromptReply(records, READER)).toBe(after.length === 0 ? null : (after.at(-1)?.text ?? null));
    });
  });
});

describe("toolCallRow", () => {
  it("names an unnamed tool and leaves the name alone otherwise", () => {
    expect(toolCallRow("  ", "")).toEqual({ kind: "tool", text: "(unnamed tool)", call: true });
    expect(toolCallRow(" Bash ", "")).toEqual({ kind: "tool", text: "Bash", call: true });
  });
  it("shows arguments up to the cap and clips past it", () => {
    const atCap = "x".repeat(200);
    expect(toolCallRow("t", atCap).text).toBe(`t ${atCap}`);
    expect(toolCallRow("t", `${atCap}y`).text).toBe(`t ${atCap}…`);
  });
});

describe("proseThenCallRows", () => {
  const callRow = (call: unknown) => toolCallRow(String(call), "");
  it("drops blank prose and a missing call list", () => {
    expect(proseThenCallRows("  ", undefined, callRow)).toEqual([]);
    expect(proseThenCallRows(null, undefined, callRow)).toEqual([]);
  });
  it("puts the prose first, then one row per call", () => {
    expect(proseThenCallRows(" hi ", ["a", "b"], callRow)).toEqual([{ kind: "assistant", text: "hi" }, callRow("a"), callRow("b")]);
  });
  it("shows a call list that is not a list as one unknown row", () => {
    expect(proseThenCallRows("", { x: 1 }, callRow)).toEqual([unknownRow({ x: 1 })]);
  });
});
