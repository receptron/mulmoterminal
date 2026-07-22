import { describe, it, expect } from "vitest";
import { nextReadRange, takeCompleteLines, turnBoundaries, HOOK_EVENT_FOR } from "../../../server/agents/codex-activity.js";

const line = (o: unknown) => JSON.stringify(o);
const started = (turnId = "t1") => line({ type: "event_msg", payload: { type: "task_started", turn_id: turnId } });
const complete = (turnId = "t1") => line({ type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: "done" } });
const agentMessage = () => line({ type: "event_msg", payload: { type: "agent_message", message: "thinking" } });
// A turn_context row carries a turn_id but no payload.type — the shape most likely to be
// misread as a boundary.
const turnContext = (turnId = "t1") => line({ type: "turn_context", payload: { turn_id: turnId, cwd: "/w" } });

describe("nextReadRange", () => {
  it("reads the appended bytes when the file grew", () => {
    expect(nextReadRange(100, 250)).toEqual({ from: 100, to: 250 });
  });

  it("reads nothing when the file is unchanged", () => {
    expect(nextReadRange(100, 100)).toBeNull();
  });

  it("starts over when the file shrank, rather than slicing from a stale offset", () => {
    expect(nextReadRange(100, 40)).toEqual({ from: 0, to: 40 });
  });

  it("handles the first read of a file that already has content", () => {
    expect(nextReadRange(0, 80)).toEqual({ from: 0, to: 80 });
  });

  it("reads nothing from an empty file", () => {
    expect(nextReadRange(0, 0)).toBeNull();
  });
});

describe("takeCompleteLines", () => {
  it("returns whole lines and keeps the trailing fragment", () => {
    expect(takeCompleteLines("", "a\nb\nhalf")).toEqual({ lines: ["a", "b"], pending: "half" });
  });

  it("joins a fragment carried from the previous poll", () => {
    const first = takeCompleteLines("", '{"ty');
    expect(first.lines).toEqual([]);
    expect(takeCompleteLines(first.pending, 'pe":"x"}\n').lines).toEqual(['{"type":"x"}']);
  });

  it("leaves nothing pending when the chunk ends on a newline", () => {
    expect(takeCompleteLines("", "a\nb\n")).toEqual({ lines: ["a", "b"], pending: "" });
  });

  it("drops blank lines rather than passing them on as records", () => {
    expect(takeCompleteLines("", "a\n\n\nb\n").lines).toEqual(["a", "b"]);
  });

  it("is empty for an empty chunk", () => {
    expect(takeCompleteLines("", "")).toEqual({ lines: [], pending: "" });
  });
});

describe("turnBoundaries", () => {
  it("reports a turn starting and finishing, in order", () => {
    expect(turnBoundaries([started(), agentMessage(), complete()])).toEqual(["started", "completed"]);
  });

  it("reports several turns from one poll without collapsing any", () => {
    expect(turnBoundaries([started("t1"), complete("t1"), started("t2"), complete("t2")])).toEqual(["started", "completed", "started", "completed"]);
  });

  it("ignores rows that are not turn boundaries", () => {
    expect(turnBoundaries([agentMessage(), line({ type: "response_item", payload: { type: "message" } })])).toEqual([]);
  });

  it("does not mistake a turn_context row for a boundary", () => {
    expect(turnBoundaries([turnContext()])).toEqual([]);
  });

  it("only treats event_msg rows as boundaries, whatever their payload says", () => {
    // Guards the `doc.type === "event_msg"` check specifically: the turn_context case
    // above passes with or without it, since that row has no payload.type at all.
    const impostor = line({ type: "response_item", payload: { type: "task_complete", last_agent_message: "no" } });
    expect(turnBoundaries([impostor])).toEqual([]);
  });

  it("skips a torn line instead of throwing", () => {
    expect(turnBoundaries(['{"type":"event_msg", "payl', complete()])).toEqual(["completed"]);
  });

  it("is empty for no lines", () => {
    expect(turnBoundaries([])).toEqual([]);
  });
});

describe("HOOK_EVENT_FOR", () => {
  it("routes codex boundaries through claude's effect table, so the rules live in one place", () => {
    expect(HOOK_EVENT_FOR.started).toBe("UserPromptSubmit");
    expect(HOOK_EVENT_FOR.completed).toBe("Stop");
  });
});
