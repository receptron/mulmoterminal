// @vitest-environment node
import { describe, it, expect } from "vitest";
import { basePlanSchema } from "../../../common/blueprint/plan";
import { initialState, type BlueprintState, type StepState } from "../../../common/blueprint/state";
import { nextAction, MAX_FAILED_CHECKS, type ExecutorInputs } from "../../../common/blueprint/executorPolicy";
import { stepPrompt, CHECK_OUTPUT_PROMPT_CHARS } from "../../../common/blueprint/stepPrompt";

const steps = basePlanSchema.parse({
  steps: [
    { id: "a", title: "A", skill: "skills/a", check: "true" },
    { id: "b", title: "B", skill: "skills/b", check: "sh check-b.sh", gates: ["billing"] },
  ],
}).steps;

const passedA: StepState = { status: "passed", approved: false, answers: [], lastCheck: { ok: true, output: "", atMs: 1 } };

const withB = (b: Partial<StepState>): BlueprintState => ({ steps: { a: passedA, b: { status: "pending", approved: false, answers: [], ...b } } });

const inputs = (state: BlueprintState, extra: Partial<ExecutorInputs> = {}): ExecutorInputs => ({
  steps,
  state,
  failedChecks: {},
  sessionActive: false,
  ...extra,
});

describe("nextAction", () => {
  it("starts the first step of a fresh build", () => {
    expect(nextAction(inputs(initialState(steps)))).toEqual({ kind: "start", stepId: "a" });
  });

  it("moves to the next step once the current one passed", () => {
    expect(nextAction(inputs(withB({})))).toEqual({ kind: "start", stepId: "b" });
  });

  it("hands a running step to a new session when none is working on it", () => {
    expect(nextAction(inputs(withB({ status: "running", approved: true })))).toEqual({ kind: "spawn", stepId: "b" });
  });

  it("waits while a session is working", () => {
    expect(nextAction(inputs(withB({ status: "running", approved: true }), { sessionActive: true }))).toEqual({ kind: "wait", stepId: "b", on: "agent" });
  });

  it.each([
    ["awaiting-approval", "approval"],
    ["awaiting-answer", "answer"],
  ] as const)("waits for a person when the step is %s", (status, on) => {
    expect(nextAction(inputs(withB({ status, question: "q" })))).toEqual({ kind: "wait", stepId: "b", on });
  });

  const failedCheck: Partial<StepState> = { status: "failed", approved: true, reason: "check failed", lastCheck: { ok: false, output: "boom", atMs: 2 } };

  it("retries a failed check automatically while attempts remain", () => {
    expect(nextAction(inputs(withB(failedCheck), { failedChecks: { b: MAX_FAILED_CHECKS - 1 } }))).toEqual({ kind: "retry", stepId: "b" });
  });

  it("stops for a person once the automatic attempts are spent", () => {
    expect(nextAction(inputs(withB(failedCheck), { failedChecks: { b: MAX_FAILED_CHECKS } }))).toEqual({ kind: "wait", stepId: "b", on: "failure" });
  });

  it("never retries a rejected gate on its own", () => {
    expect(nextAction(inputs(withB({ status: "failed", reason: "too expensive" })))).toEqual({ kind: "wait", stepId: "b", on: "failure" });
  });

  it("is done when every step passed", () => {
    expect(nextAction(inputs({ steps: { a: passedA, b: { ...passedA } } }))).toEqual({ kind: "done" });
  });
});

describe("stepPrompt", () => {
  const prompt = (stepState: StepState | undefined) =>
    stepPrompt({ step: steps[1], skillFile: "/packs/firebase/skills/b/SKILL.md", stepState, askCommand: "ASK" });

  it("names the skill, the spec, the way to ask and the check", () => {
    const text = prompt(undefined);
    expect(text).toContain("/packs/firebase/skills/b/SKILL.md");
    expect(text).toContain(".blueprint/spec.md");
    expect(text).toContain("QUESTION='your question' ASK");
    expect(text).toContain("sh check-b.sh");
  });

  it("carries earlier answers so they are not asked again", () => {
    const text = prompt({ status: "running", approved: true, answers: [{ question: "Region?", answer: "Tokyo", atMs: 1 }] });
    expect(text).toContain("Q: Region?");
    expect(text).toContain("A: Tokyo");
  });

  it("carries the tail of a failing check's output, and only the tail", () => {
    const output = `${"x".repeat(CHECK_OUTPUT_PROMPT_CHARS)}THE-END`;
    const text = prompt({ status: "running", approved: true, answers: [], lastCheck: { ok: false, output, atMs: 1 } });
    expect(text).toContain("THE-END");
    expect(text).not.toContain("x".repeat(CHECK_OUTPUT_PROMPT_CHARS + 1));
  });

  it("says nothing about a check that passed", () => {
    expect(prompt({ status: "running", approved: true, answers: [], lastCheck: { ok: true, output: "fine", atMs: 1 } })).not.toContain("did not pass");
  });
});
