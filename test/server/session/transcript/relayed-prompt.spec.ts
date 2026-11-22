// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ownWordsOf } from "../../../../server/session/transcript/relayed-prompt.js";
import { formatHandoff, formatRelay } from "../../../../server/session/transcript/handoff-text.js";
import { DEFAULT_RELAY_LIMITS, relayTurnChars } from "../../../../server/session/transcript/relay-range.js";

const source = { label: "codex · feat/x", cwd: "/w/proj" };
const turn = (prompt: string, reply: string) => ({ prompt, promptClipped: false, replies: [reply], at: null });

// Every shape a pasted handoff takes, produced by the formatters themselves rather than typed out.
const pastedHandoffs = (): string[] => [
  formatHandoff(source, { prompt: "review the plan", reply: "step four is wrong" }),
  formatHandoff(source, { prompt: null, reply: "only an answer" }, undefined, "reply"),
  formatHandoff({ label: "claude", cwd: null }, { prompt: "q", reply: "a\n\nmulti\nline" }),
  formatRelay(source, { turns: [turn("one", "first"), turn("two", "second")], omitted: 0, moreBefore: false, markLost: false }),
  formatRelay(source, { turns: [turn("only", "reply")], omitted: 3, moreBefore: false, markLost: false }),
];

describe("ownWordsOf", () => {
  it("drops a pasted handoff that the human added nothing to", () => {
    pastedHandoffs().forEach((pasted) => expect(ownWordsOf(pasted)).toBe(""));
  });

  it("keeps what the human typed after the pasted handoff", () => {
    const extras = ["what do you think?", "the plan assumes node 22\n\nanswer in Japanese", "  padded  "];
    pastedHandoffs().forEach((pasted) => extras.forEach((extra) => expect(ownWordsOf(`${pasted}\n\n${extra}`)).toBe(extra.trim())));
  });

  it("takes a handoff the log clipped before its end line as all handoff", () => {
    pastedHandoffs().forEach((pasted) => expect(ownWordsOf(pasted.slice(0, pasted.indexOf("--- end ---")))).toBe(""));
  });

  it("leaves a prompt that is not a handoff exactly as it was", () => {
    ["review this", "", "   ", "see Another terminal (x) above", "--- end ---", "line one\n--- end ---\nline two"].forEach((prompt) =>
      expect(ownWordsOf(prompt)).toBe(prompt),
    );
  });

  it("leaves a human prompt that merely starts with the opening words alone", () => {
    [
      "Another terminal (the codex one) said the plan is wrong",
      "Another terminal (x)\n\nfirst\n--- end ---\nsecond",
      "Another terminal (codex) failed.\nThe quoted block below contains the error:\nboom",
    ].forEach((prompt) => expect(ownWordsOf(prompt)).toBe(prompt));
  });

  it("recognises a handoff after leading whitespace", () => {
    expect(ownWordsOf(`\n  ${formatHandoff(source, { prompt: "q", reply: "a" })}\n\nmine`)).toBe("mine");
  });

  it("cuts at the LAST end line, so an end line the human typed themselves ends the pasted part", () => {
    const pasted = formatHandoff(source, { prompt: "q", reply: "a" });
    expect(ownWordsOf(`${pasted}\n\nfirst\n--- end ---\nsecond`)).toBe("second");
  });
});

describe("the formatters do not echo a relayed prompt back", () => {
  const pasted = formatHandoff(source, { prompt: "their question", reply: "their answer" });

  it("formatHandoff quotes only what the human added", () => {
    const text = formatHandoff(source, { prompt: `${pasted}\n\nmy note`, reply: "my reply" });
    expect(text).toContain("--- their prompt ---\n\nmy note");
    expect(text).not.toContain("their question");
  });

  it("formatHandoff leaves the prompt block out when the human added nothing", () => {
    const text = formatHandoff(source, { prompt: pasted, reply: "my reply" });
    expect(text).not.toContain("their prompt");
    expect(text).toContain("my reply");
  });

  it("formatRelay does the same per turn", () => {
    const text = formatRelay(source, { turns: [turn(pasted, "r1"), turn("plain", "r2")], omitted: 0, moreBefore: false, markLost: false });
    expect(text).not.toContain("their question");
    expect(text).not.toContain("--- their prompt (1/2) ---");
    expect(text).toContain("--- their reply (1/2) ---\n\nr1");
    expect(text).toContain("--- their prompt (2/2) ---\n\nplain");
  });
});

describe("the relay budget counts the prompt as it is sent", () => {
  it("a turn whose prompt was only a pasted handoff costs its reply", () => {
    const pasted = formatHandoff(source, { prompt: "x".repeat(2_000), reply: "y" });
    expect(relayTurnChars(turn(pasted, "reply"), DEFAULT_RELAY_LIMITS)).toBe("reply".length);
    expect(relayTurnChars(turn(`${pasted}\n\nmine`, "reply"), DEFAULT_RELAY_LIMITS)).toBe("mine".length + "reply".length);
    expect(relayTurnChars(turn("plain", "reply"), DEFAULT_RELAY_LIMITS)).toBe("plain".length + "reply".length);
  });
});
