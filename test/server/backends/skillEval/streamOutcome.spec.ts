// @vitest-environment node
// Reading one `claude -p` stream-json run (#3438): the skill under test invoked or not, the result
// line's cost and refusals, and the ways a run fails to give a result.
import { describe, it, expect } from "vitest";
import { streamOutcome } from "../../../../server/backends/skillEval/streamOutcome";

const line = (value: unknown): string => JSON.stringify(value);
const skillCall = (skill: string): string =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Skill", input: { skill } }] } });
const result = (extra: Record<string, unknown> = {}): string =>
  line({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.02, permission_denials: [], ...extra });

describe("streamOutcome", () => {
  it("sees the skill invoked, and reads the result line", () => {
    expect(streamOutcome([line({ type: "system" }), skillCall("weekly"), result()], "weekly")).toEqual({
      skillInvoked: true,
      finalText: "done",
      costUsd: 0.02,
      denied: [],
      error: null,
    });
  });

  it("does not count another skill, or a different tool", () => {
    const other = line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { skill: "weekly" } }] } });
    expect(streamOutcome([skillCall("weekly-2"), other, result()], "weekly").skillInvoked).toBe(false);
  });

  it("lists the tools that were refused", () => {
    const denied = result({ permission_denials: [{ tool_name: "Bash", tool_input: {} }, { nope: 1 }] });
    expect(streamOutcome([denied], "weekly").denied).toEqual(["Bash"]);
  });

  it("calls a run that hit its budget or errored a failure, and one with no result line too", () => {
    expect(streamOutcome([result({ subtype: "error_max_budget_usd" })], "w").error).toBe("the run ended with error_max_budget_usd");
    expect(streamOutcome([result({ is_error: true, result: "boom" })], "w").error).toBe("boom");
    expect(streamOutcome([skillCall("w"), "{not json", ""], "w")).toMatchObject({ skillInvoked: true, error: "the run gave no result" });
  });
});
