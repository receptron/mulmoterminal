import { describe, it, expect } from "vitest";
import { lastTurnFromClaudeJsonl, lastTurnFromClaudeParsed, lastTurnFromCodexRollout, EMPTY_TURN } from "../../../server/session/last-turn.js";
import { parseJsonl } from "../../../server/session/transcript.js";

const line = (o: unknown) => JSON.stringify(o);
const user = (text: string) => line({ type: "user", message: { content: text } });
const assistant = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const toolUse = (name: string) => line({ type: "assistant", message: { content: [{ type: "tool_use", name, input: {} }] } });

// codex rollout rows, in the shape the real ~/.codex/sessions/**/rollout-*.jsonl uses:
// only the turn boundaries carry turn_id, and task_complete carries the whole reply.
const started = (turnId: string) => line({ type: "event_msg", payload: { type: "task_started", turn_id: turnId } });
const turnContext = (turnId: string) => line({ type: "turn_context", payload: { turn_id: turnId, cwd: "/w" } });
const userMessage = (message: string) => line({ type: "event_msg", payload: { type: "user_message", message } });
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
