// @vitest-environment node
// Reading one `claude -p` stream-json run (#3438): the skill under test invoked or not, the result
// line's cost and refusals, and the ways a run fails to give a result.
import { describe, it, expect } from "vitest";
import { streamOutcome } from "../../../../server/backends/skillEval/streamOutcome";

const line = (value: unknown): string => JSON.stringify(value);
const skillCall = (skill: string, id = "t"): string =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] } });
const toolResult = (id: string, isError = false): string =>
  line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "x" }] } });
const result = (extra: Record<string, unknown> = {}): string =>
  line({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.02, permission_denials: [], ...extra });

describe("streamOutcome", () => {
  it("sees the skill invoked, and reads the result line", () => {
    expect(streamOutcome([line({ type: "system" }), skillCall("weekly"), toolResult("t"), result()], "weekly")).toEqual({
      skillInvoked: true,
      finalText: "done",
      costUsd: 0.02,
      denied: [],
      error: null,
      apiError: null,
    });
  });

  it("does not count another skill, or a different tool", () => {
    const other = line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { skill: "weekly" } }] } });
    expect(streamOutcome([skillCall("weekly-2"), other, result()], "weekly").skillInvoked).toBe(false);
  });

  it("counts the skill only once a call for it came back without an error", () => {
    expect(streamOutcome([skillCall("weekly"), result()], "weekly").skillInvoked).toBe(false);
    expect(streamOutcome([skillCall("weekly", "a"), toolResult("a", true), result()], "weekly").skillInvoked).toBe(false);
    expect(streamOutcome([skillCall("weekly", "a"), toolResult("a", true), skillCall("weekly", "b"), toolResult("b"), result()], "weekly").skillInvoked).toBe(
      true,
    );
    // A result for another call does not stand in for this one.
    expect(streamOutcome([skillCall("weekly", "a"), toolResult("z"), result()], "weekly").skillInvoked).toBe(false);
  });

  it("lists the tools that were refused", () => {
    const denied = result({ permission_denials: [{ tool_name: "Bash", tool_input: {} }, { nope: 1 }] });
    expect(streamOutcome([denied], "weekly").denied).toEqual(["Bash"]);
  });

  it("calls a run that hit its budget or errored a failure, and one with no result line too", () => {
    expect(streamOutcome([result({ subtype: "error_max_budget_usd" })], "w").error).toBe("the run ended with error_max_budget_usd");
    expect(streamOutcome([result({ is_error: true, result: "boom" })], "w").error).toBe("boom");
    expect(streamOutcome([skillCall("w"), toolResult("t"), "{not json", ""], "w")).toMatchObject({ skillInvoked: true, error: "the run gave no result" });
    expect(streamOutcome([result({ subtype: "error_max_budget_usd" })], "w").apiError).toBeNull();
  });

  // The result line claude printed with an expired login.
  const unreached = {
    is_error: true,
    result: "Failed to authenticate: OAuth session expired and could not be refreshed",
    terminal_reason: "api_error",
    total_cost_usd: 0,
  };

  it("tells a run that never reached the model from one that failed the task", () => {
    expect(streamOutcome([result(unreached)], "w")).toMatchObject({ error: unreached.result, apiError: unreached.result });
    expect(streamOutcome([result({ ...unreached, result: "" })], "w").apiError).toBe("claude could not reach the model");
    expect(streamOutcome([result({ is_error: true, result: "boom", terminal_reason: "completed" })], "w").apiError).toBeNull();
    expect(streamOutcome([result({ is_error: true, result: "boom", terminal_reason: 1 })], "w").apiError).toBeNull();
  });
});
