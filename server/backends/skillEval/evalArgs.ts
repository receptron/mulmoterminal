// The command lines and prompts of a skill evaluation (#3438). Pure.
//
// Both the agent and the grader run with `--setting-sources project` and `--strict-mcp-config` in a
// fresh directory: the user's CLAUDE.md, skills, plugins, hooks and MCP servers are not loaded, so the
// only skill the agent can find is the one copied into that directory. Measured on one write task:
// $0.11 with the user's setup loaded, $0.019 without — the hooks' context and the plugins' skill list
// are most of a short run's cost, and they would be the same noise in both arms.
import type { SkillEvalArm, SkillEvalCase } from "../../../common/skillEval.js";

const ISOLATION = ["--setting-sources", "project", "--strict-mcp-config"];

export const JUDGE_SCHEMA = JSON.stringify({
  type: "object",
  properties: { pass: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } } },
  required: ["pass", "reasons"],
});

/** The agent reads its prompt from stdin, so a variadic flag such as `--allowedTools` cannot swallow it. */
export function agentArgs(model: string, budgetUsd: number, allowedTools: readonly string[]): string[] {
  return [
    ...["-p", "--model", model, "--max-budget-usd", String(budgetUsd)],
    ...["--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"],
    ...ISOLATION,
    ...(allowedTools.length > 0 ? ["--allowedTools", ...allowedTools] : []),
  ];
}

/** The writer of an improvement (#3448): it edits the copy in its folder and may run nothing. */
export function improveArgs(model: string, budgetUsd: number): string[] {
  return agentArgs(model, budgetUsd, []);
}

/** With the skill on a "use" case, the request names it: unnamed, a skill is read about half the time. */
export function agentPrompt(evalCase: SkillEvalCase, arm: SkillEvalArm, skillSlug: string): string {
  if (arm === "with" && evalCase.kind === "use") return `Use the "${skillSlug}" skill for this task.\n\n${evalCase.prompt}`;
  return evalCase.prompt;
}

/** The grader may only read: it judges what is in the directory, never changes it. */
export function judgeArgs(model: string, budgetUsd: number): string[] {
  return [
    ...["-p", "--model", model, "--max-budget-usd", String(budgetUsd), "--output-format", "json"],
    ...ISOLATION,
    ...["--json-schema", JUDGE_SCHEMA, "--tools", "Read", "Glob", "Grep"],
  ];
}

export function judgePrompt(evalCase: SkillEvalCase, items: readonly string[], finalText: string): string {
  return [
    "You are grading whether an AI agent completed a task. The files it produced are in the current directory.",
    "Pass only if EVERY item below holds. Check the files themselves: the agent's last message may claim work it did not do.",
    "",
    "Task given to the agent:",
    evalCase.prompt,
    "",
    "Items that must all hold:",
    ...items.map((item, i) => `${String(i + 1)}. ${item}`),
    "",
    "The agent's last message:",
    finalText === "" ? "(none)" : finalText,
  ].join("\n");
}
