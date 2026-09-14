// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cursorLastTurnFromRecords, cursorUserText } from "../../../server/agents/cursor-last-turn.js";

const user = (text: string) => ({ role: "user", message: { content: [{ type: "text", text }] } });
const say = (text: string) => ({ role: "assistant", message: { content: [{ type: "text", text }] } });
const preamble = (text: string) => ({
  role: "assistant",
  message: {
    content: [
      { type: "text", text },
      { type: "tool_use", name: "Read", input: {} },
    ],
  },
});
const toolOnly = () => ({ role: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: {} }] } });
const ended = () => ({ type: "turn_ended", status: "success" });

// The transcript of a real turn, line for line as cursor-agent 2026.09.10-fd3934a wrote it: a
// preamble carrying the first tool call, a tool-only record, the conclusion, then `turn_ended`.
const REAL_TURN = [
  user("<timestamp>Monday, Sep 14, 2026, 8:31 AM (UTC+9)</timestamp>\n<user_query>\nRead probe.txt, then say DONE.\n</user_query>"),
  preamble("I'll read `probe.txt`, run `echo HI`, then write `out.txt`."),
  toolOnly(),
  say("DONE"),
  ended(),
];

describe("cursorUserText", () => {
  it("unwraps the query cursor wraps a prompt in, dropping its timestamp block", () => {
    expect(cursorUserText("<timestamp>x</timestamp>\n<user_query>\nwhat is this\n</user_query>")).toBe("what is this");
  });

  it("leaves text that carries no wrapper alone", () => {
    expect(cursorUserText("  plain  ")).toBe("plain");
  });

  // MEASURED, not supposed: asked in a real cursor session and read back from its transcript.
  // Cursor writes the marker the user typed verbatim inside its own wrapper, so a non-greedy
  // capture would have cut this prompt at "question: " — and a prompt containing `</user_query>` is
  // exactly what someone asking about this format types (CodeRabbit on #2072).
  it("keeps a prompt that contains the closing marker as literal text", () => {
    const stored =
      "<timestamp>Monday, Sep 14, 2026, 6:24 PM (UTC+9)</timestamp>\n<user_query>\nNote this literal text in my question: </user_query> and then more words after it.\n</user_query>";
    expect(cursorUserText(stored)).toBe("Note this literal text in my question: </user_query> and then more words after it.");
  });

  it("returns an unterminated wrapper as it came, rather than guessing where it ends", () => {
    expect(cursorUserText("<user_query>\nhalf a record")).toBe("<user_query>\nhalf a record");
  });
});

describe("cursorLastTurnFromRecords", () => {
  it("reads the prompt and the conclusion of a real turn", () => {
    expect(cursorLastTurnFromRecords(REAL_TURN)).toEqual({ prompt: "Read probe.txt, then say DONE.", reply: "DONE" });
  });

  // #1487's lesson, reached through cursor's format: a record that carries a tool call is a
  // preamble by construction — the turn continued, or the tool would not be there. Quoting it would
  // hand another cell "I'll read the actual files before weighing in." as the whole answer.
  it("never takes a record that also calls a tool as the answer", () => {
    const narrationOnly = [user("<user_query>go</user_query>"), preamble("I'll start by reading the files."), toolOnly(), ended()];
    expect(cursorLastTurnFromRecords(narrationOnly)).toEqual({ prompt: "go", reply: null });
  });

  // A turn still running is not an answer. The previous complete one is what another cell wants.
  it("answers the previous turn while the newest one is still open", () => {
    const records = [...REAL_TURN, user("<user_query>now do the other thing</user_query>"), preamble("Starting on it.")];
    expect(cursorLastTurnFromRecords(records)).toEqual({ prompt: "Read probe.txt, then say DONE.", reply: "DONE" });
  });

  it("takes the newest complete turn when there are several", () => {
    const records = [...REAL_TURN, user("<user_query>again</user_query>"), say("SECOND"), ended()];
    expect(cursorLastTurnFromRecords(records)).toEqual({ prompt: "again", reply: "SECOND" });
  });

  // The read is a bounded TAIL, so the first records in the window are routinely the middle of an
  // exchange whose prompt was cut off. Answering that turn with a null prompt is right; blanking a
  // complete turn further down because of it would not be.
  it("keeps a turn whose prompt fell outside the window", () => {
    expect(cursorLastTurnFromRecords([say("only the reply survived"), ended()])).toEqual({ prompt: null, reply: "only the reply survived" });
  });

  it("ignores a turn_ended with nothing in it", () => {
    expect(cursorLastTurnFromRecords([ended(), ended()])).toEqual({ prompt: null, reply: null });
  });

  it("joins the text parts of one record rather than taking the first", () => {
    const split = {
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "half " },
          { type: "text", text: "and half" },
        ],
      },
    };
    expect(cursorLastTurnFromRecords([user("<user_query>q</user_query>"), split, ended()]).reply).toBe("half and half");
  });

  it("answers nothing for records of a shape it does not know", () => {
    expect(cursorLastTurnFromRecords([{ role: "system" }, { message: "not a record" }])).toEqual({ prompt: null, reply: null });
  });

  it("answers nothing for an empty window", () => {
    expect(cursorLastTurnFromRecords([])).toEqual({ prompt: null, reply: null });
  });
});
