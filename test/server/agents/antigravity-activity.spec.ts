import { describe, it, expect } from "vitest";
import { boundaryOutcome, parseAntigravityTranscriptLine } from "../../../server/agents/antigravity-activity.js";

describe("antigravity-activity", () => {
  it("parses user_start from USER_INPUT line", () => {
    const line = JSON.stringify({ type: "USER_INPUT", source: "USER_EXPLICIT", content: "Hello" });
    expect(parseAntigravityTranscriptLine(line)).toBe("user_start");
  });

  it("parses turn_complete from PLANNER_RESPONSE with no tool calls", () => {
    const line = JSON.stringify({ type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [] });
    expect(parseAntigravityTranscriptLine(line)).toBe("turn_complete");
  });

  it("returns correct boundary outcomes for active and inactive states", () => {
    const userStart = boundaryOutcome("user_start", false);
    expect(userStart.effects).toEqual([
      { kind: "working", value: true },
      { kind: "waiting", value: false },
    ]);
    expect(userStart.push).toBeNull();

    const turnCompleteInactive = boundaryOutcome("turn_complete", false);
    expect(turnCompleteInactive.effects).toEqual([
      { kind: "working", value: false },
      { kind: "waiting", value: true },
    ]);
    expect(turnCompleteInactive.push).toBe("Turn completed");

    const turnCompleteActive = boundaryOutcome("turn_complete", true);
    expect(turnCompleteActive.effects).toEqual([
      { kind: "working", value: false },
      { kind: "waiting", value: false },
    ]);
    expect(turnCompleteActive.push).toBeNull();
  });
});
