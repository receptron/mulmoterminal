// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  currentTurnReplyFromClaudeParsed,
  lastTurnFromClaudeJsonl,
  lastTurnFromClaudeParsed,
  lastTurnFromCodexRollout,
  EMPTY_TURN,
} from "../../../server/session/last-turn.js";
import { parseJsonl } from "../../../server/session/transcript.js";

const line = (o: unknown) => JSON.stringify(o);
const user = (text: string) => line({ type: "user", message: { content: text } });
const assistant = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
// The real file carries a stop reason on every assistant record, and `tool_use` is the one that
// means "still working". The helper above omits it on purpose — a record without one has to keep
// counting as the end of a turn (#1487) — so these two model what Claude actually writes.
const narrating = (text: string) => line({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "text", text }] } });
const concluding = (text: string, stopReason = "end_turn") =>
  line({ type: "assistant", message: { stop_reason: stopReason, content: [{ type: "text", text }] } });
const toolUse = (name: string) => line({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name, input: {} }] } });

// codex rollout rows, in the shape the real ~/.codex/sessions/**/rollout-*.jsonl uses:
// only the turn boundaries carry turn_id, and task_complete carries the whole reply.
const started = (turnId: string) => line({ type: "event_msg", payload: { type: "task_started", turn_id: turnId } });
const turnContext = (turnId: string) => line({ type: "turn_context", payload: { turn_id: turnId, cwd: "/w" } });
const userMessage = (message: string) => line({ type: "event_msg", payload: { type: "user_message", message } });
// The shape codex writes since 2026-08 (#2011), and the preamble it puts in front of the prompt.
const userItem = (...texts: string[]) =>
  line({ type: "response_item", payload: { type: "message", role: "user", content: texts.map((text) => ({ type: "input_text", text })) } });
const preamble = () =>
  userItem(
    "<recommended_plugins>\nAirtable\n</recommended_plugins>",
    "# AGENTS.md instructions for /w\n\nbe nice",
    "<environment_context>\n  <cwd>/w</cwd>\n</environment_context>",
  );
const agentMessage = (message: string) => line({ type: "event_msg", payload: { type: "agent_message", message } });
const complete = (turnId: string, lastAgentMessage: string) =>
  line({ type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: lastAgentMessage } });

describe("lastTurnFromClaudeParsed", () => {
  it("pairs the final prompt with the turn's concluding prose", () => {
    const raw = [user("first"), assistant("first answer"), user("second"), assistant("second answer")].join("\n");
    expect(lastTurnFromClaudeJsonl(raw)).toEqual({ prompt: "second", reply: "second answer" });
  });

  it("takes the LAST prose record of a turn, not the narration before the tools", () => {
    const raw = [user("do X"), assistant("let me look"), toolUse("Read"), assistant("done — here is why")].join("\n");
    expect(lastTurnFromClaudeJsonl(raw)).toEqual({ prompt: "do X", reply: "done — here is why" });
  });

  // The case above with the stop reasons the real file carries. Without them the fixture passed
  // while the shipped code relayed the preamble: a round table seat contributed "I'll read the
  // actual files before weighing in." and its real answer — which disagreed with the others —
  // arrived 40 seconds later and was never passed on (#1487).
  it("does not mistake the preamble before a tool call for the answer", () => {
    const raw = [user("do X"), narrating("I'll read the actual files before weighing in."), toolUse("Read"), concluding("LRU, and here is why")].join("\n");
    expect(lastTurnFromClaudeJsonl(raw)).toEqual({ prompt: "do X", reply: "LRU, and here is why" });
  });

  // The same records, caught mid-flight: the preamble is on disk and the answer is not yet. The
  // previous exchange is the honest answer — handing on the preamble is what the bug did.
  it("falls back to the previous exchange while the agent is still narrating", () => {
    const raw = [user("first"), concluding("first answer"), user("do X"), narrating("let me look"), toolUse("Read")].join("\n");
    expect(lastTurnFromClaudeJsonl(raw)).toEqual({ prompt: "first", reply: "first answer" });
  });

  // Every stop reason other than tool_use ends the turn one way or another, and a record with no
  // stop reason at all counts as ending it — being wrong the other way would leave a turn that
  // never completes, so every exchange waiting on it would time out.
  it("treats any non-tool_use stop reason, and a missing one, as the end of the turn", () => {
    expect(lastTurnFromClaudeJsonl([user("q"), concluding("a", "stop_sequence")].join("\n"))).toEqual({ prompt: "q", reply: "a" });
    expect(lastTurnFromClaudeJsonl([user("q"), concluding("a", "max_tokens")].join("\n"))).toEqual({ prompt: "q", reply: "a" });
    expect(lastTurnFromClaudeJsonl([user("q"), assistant("a")].join("\n"))).toEqual({ prompt: "q", reply: "a" });
  });

  it("falls back to the previous exchange while a turn is still in flight", () => {
    const raw = [user("first"), assistant("first answer"), user("second, still running"), toolUse("Bash")].join("\n");
    expect(lastTurnFromClaudeJsonl(raw)).toEqual({ prompt: "first", reply: "first answer" });
  });

  it("reports a reply with no preceding prompt rather than borrowing one", () => {
    const raw = [assistant("resumed context")].join("\n");
    expect(lastTurnFromClaudeJsonl(raw)).toEqual({ prompt: null, reply: "resumed context" });
  });

  it("is empty for an empty transcript, a prompt-only transcript, and malformed lines", () => {
    expect(lastTurnFromClaudeJsonl("")).toEqual(EMPTY_TURN);
    expect(lastTurnFromClaudeJsonl(user("hello"))).toEqual(EMPTY_TURN);
    expect(lastTurnFromClaudeJsonl(["{ not json", user("hi"), assistant("yo")].join("\n"))).toEqual({ prompt: "hi", reply: "yo" });
    expect(lastTurnFromClaudeParsed(parseJsonl(""))).toEqual(EMPTY_TURN);
  });

  it("skips slash-command wrappers, which are not typed prompts", () => {
    const raw = [user("real prompt"), user("<local-command-stdout>ok</local-command-stdout>"), assistant("answer")].join("\n");
    expect(lastTurnFromClaudeJsonl(raw)).toEqual({ prompt: "real prompt", reply: "answer" });
  });
});

// The push body's read. Everything above answers "what was the last complete exchange"; this one
// answers "what did the turn that just ended produce", and the difference is the whole point: it
// must go silent rather than hand the phone an older turn's reply (#1650).
describe("currentTurnReplyFromClaudeParsed", () => {
  const reply = (raw: string) => currentTurnReplyFromClaudeParsed(parseJsonl(raw));

  it("returns the concluding prose of the newest turn", () => {
    expect(reply([user("first"), concluding("first answer"), user("second"), concluding("second answer")].join("\n"))).toBe("second answer");
  });

  it("takes the turn's last prose, not the preamble before its tools", () => {
    expect(reply([user("do X"), narrating("let me look"), toolUse("Read"), concluding("done — here is why")].join("\n"))).toBe("done — here is why");
  });

  // #1650: the previous turn's reply is exactly what a stale push carried, so it may not survive
  // a new prompt. A read that lands while the turn is still running gets nothing at all.
  it("does not borrow the previous turn's reply while the newest turn is still running", () => {
    expect(reply([user("first"), concluding("first answer"), user("second"), narrating("let me look"), toolUse("Bash")].join("\n"))).toBeNull();
  });

  // The deterministic half of #1650: an interrupted turn (or one that finished on a tool call)
  // ends with no prose, yet Stop still fires and a push still goes out.
  it("is null for a turn that ended without any prose", () => {
    expect(reply([user("first"), concluding("first answer"), user("second"), toolUse("Bash")].join("\n"))).toBeNull();
  });

  it("is not reset by a slash-command wrapper, which is not a typed prompt", () => {
    expect(reply([user("real prompt"), concluding("answer"), user("<local-command-stdout>ok</local-command-stdout>")].join("\n"))).toBe("answer");
  });

  it("reports a reply that has no preceding prompt, and is null for an empty transcript", () => {
    expect(reply(concluding("resumed context"))).toBe("resumed context");
    expect(reply("")).toBeNull();
    expect(reply(user("hello"))).toBeNull();
  });
});

describe("lastTurnFromCodexRollout", () => {
  it("takes the last completed turn's prompt and its whole final message", () => {
    const raw = [
      started("t1"),
      turnContext("t1"),
      userMessage("first"),
      agentMessage("thinking"),
      complete("t1", "first answer"),
      started("t2"),
      turnContext("t2"),
      userMessage("second"),
      complete("t2", "second answer\nwith a second line"),
    ].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: "second", reply: "second answer\nwith a second line" });
  });

  // #2011: codex moved the user's turn to a response_item during 2026-08, and the handoff's prompt
  // half went null for every session started since — the receiving cell got an answer with no
  // question in it.
  it("takes a prompt written in the response_item shape codex uses now", () => {
    const raw = [started("t1"), turnContext("t1"), preamble(), userItem("review the branch"), complete("t1", "reviewed it")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: "review the branch", reply: "reviewed it" });
  });

  it("does not hand over codex's own preamble as the prompt", () => {
    const raw = [started("t1"), preamble(), complete("t1", "answered anyway")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: null, reply: "answered anyway" });
  });

  // The older rollouts on disk carry the prompt in BOTH shapes, back to back. Either half is the
  // same text, so the turn reads the same whichever one it meets first.
  it("reads a turn codex wrote in both shapes", () => {
    const raw = [started("t1"), userItem("review the branch"), userMessage("review the branch"), complete("t1", "reviewed it")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: "review the branch", reply: "reviewed it" });
  });

  it("falls back to the previous turn while the newest one is still running", () => {
    const raw = [started("t1"), userMessage("first"), complete("t1", "first answer"), started("t2"), userMessage("second")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: "first", reply: "first answer" });
  });

  it("skips a turn that completed without a final message", () => {
    const raw = [started("t1"), userMessage("first"), complete("t1", "first answer"), started("t2"), userMessage("second"), complete("t2", "")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: "first", reply: "first answer" });
  });

  it("pairs by turn_id, so an interleaved boundary does not steal the wrong prompt", () => {
    const raw = [
      started("t1"),
      userMessage("first"),
      complete("t1", "first answer"),
      started("t2"),
      userMessage("second"),
      complete("t2", "second answer"),
    ].join("\n");
    expect(lastTurnFromCodexRollout(raw).prompt).toBe("second");
  });

  it("reports a prompt-less turn when its task_started is missing", () => {
    const raw = [userMessage("orphaned"), complete("t9", "answer")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: null, reply: "answer" });
  });

  it("ignores a turn with no user_message inside its span", () => {
    const raw = [started("t1"), agentMessage("unprompted"), complete("t1", "answer")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: null, reply: "answer" });
  });

  it("is empty for an empty rollout, a head-only rollout, and malformed lines", () => {
    expect(lastTurnFromCodexRollout("")).toEqual(EMPTY_TURN);
    expect(lastTurnFromCodexRollout(line({ type: "session_meta", payload: { id: "x" } }))).toEqual(EMPTY_TURN);
    expect(lastTurnFromCodexRollout(["{ truncated", started("t1"), userMessage("hi"), complete("t1", "yo")].join("\n"))).toEqual({ prompt: "hi", reply: "yo" });
  });

  it("does not mistake a turn_context row for an event payload", () => {
    const raw = [started("t1"), turnContext("t1"), userMessage("hi"), complete("t1", "yo")].join("\n");
    expect(lastTurnFromCodexRollout(raw)).toEqual({ prompt: "hi", reply: "yo" });
  });
});
