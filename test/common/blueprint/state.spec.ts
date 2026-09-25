// @vitest-environment node
import { describe, it, expect } from "vitest";
import { basePlanSchema } from "../../../common/blueprint/plan";
import {
  applyEvent,
  blueprintStateSchema,
  currentStep,
  initialState,
  isAgentEvent,
  stateProblems,
  STEP_STATUSES,
  waitingOn,
  type BlueprintState,
  type StepEvent,
  type StepStatus,
} from "../../../common/blueprint/state";

const steps = basePlanSchema.parse({
  steps: [
    { id: "init", title: "init", skill: "s", check: "true" },
    { id: "billing", title: "billing", skill: "s", check: "true", gates: ["billing"] },
    { id: "deploy", title: "deploy", skill: "s", check: "true", gates: ["deploy-production"] },
  ],
}).steps;

function run(events: [string, StepEvent][], from: BlueprintState = initialState(steps)): BlueprintState {
  return events.reduce((state, [id, event]) => {
    const result = applyEvent(steps, state, id, event);
    if (!result.ok) throw new Error(`${id} ${event.type}: ${result.reason}`);
    return result.state;
  }, from);
}

const passed = (atMs = 1): StepEvent => ({ type: "check", ok: true, output: "", atMs });
const statusOf = (state: BlueprintState, id: string) => state.steps[id].status;

describe("applyEvent — the happy path", () => {
  it("runs an ungated step straight away and passes it on a green check", () => {
    const state = run([
      ["init", { type: "start" }],
      ["init", passed()],
    ]);
    expect(statusOf(state, "init")).toBe("passed");
    expect(currentStep(steps, state)?.id).toBe("billing");
  });

  it("holds a gated step for approval, then runs it", () => {
    const held = run([
      ["init", { type: "start" }],
      ["init", passed()],
      ["billing", { type: "start" }],
    ]);
    expect(statusOf(held, "billing")).toBe("awaiting-approval");
    expect(waitingOn(steps, held)).toEqual({ stepId: "billing", kind: "approval" });
    const approved = run([["billing", { type: "approve" }]], held);
    expect(approved.steps.billing).toMatchObject({ status: "running", approved: true });
  });

  it("stops on a question and resumes on the answer, keeping the exchange", () => {
    const asked = run([
      ["init", { type: "start" }],
      ["init", { type: "ask", question: "Which region?" }],
    ]);
    expect(waitingOn(steps, asked)).toEqual({ stepId: "init", kind: "answer" });
    const answered = run([["init", { type: "answer", answer: "asia-northeast1", atMs: 5 }]], asked);
    expect(answered.steps.init).toMatchObject({
      status: "running",
      question: undefined,
      answers: [{ question: "Which region?", answer: "asia-northeast1", atMs: 5 }],
    });
  });

  it("reports nothing current once every step passed", () => {
    const done = run([
      ["init", { type: "start" }],
      ["init", passed()],
      ["billing", { type: "start" }],
      ["billing", { type: "approve" }],
      ["billing", passed()],
      ["deploy", { type: "start" }],
      ["deploy", { type: "approve" }],
      ["deploy", passed()],
    ]);
    expect(currentStep(steps, done)).toBeNull();
    expect(waitingOn(steps, done)).toBeNull();
  });
});

describe("applyEvent — failure and retry", () => {
  it("fails on a red check and records the output", () => {
    const state = run([
      ["init", { type: "start" }],
      ["init", { type: "check", ok: false, output: "boom", atMs: 9 }],
    ]);
    expect(state.steps.init).toMatchObject({ status: "failed", reason: "check failed", lastCheck: { ok: false, output: "boom", atMs: 9 } });
    expect(waitingOn(steps, state)).toEqual({ stepId: "init", kind: "failure" });
  });

  it("keeps an approval across a retry, so a failed billing step is not asked twice", () => {
    const state = run([
      ["init", { type: "start" }],
      ["init", passed()],
      ["billing", { type: "start" }],
      ["billing", { type: "approve" }],
      ["billing", { type: "check", ok: false, output: "", atMs: 1 }],
      ["billing", { type: "retry" }],
      ["billing", { type: "start" }],
    ]);
    expect(statusOf(state, "billing")).toBe("running");
  });

  it("fails a rejected gate with the reason given", () => {
    const state = run([
      ["init", { type: "start" }],
      ["init", passed()],
      ["billing", { type: "start" }],
      ["billing", { type: "reject", reason: "too expensive" }],
    ]);
    expect(state.steps.billing).toMatchObject({ status: "failed", reason: "too expensive", approved: false });
  });
});

describe("applyEvent — refusals", () => {
  const refuse = (state: BlueprintState, id: string, event: StepEvent) => applyEvent(steps, state, id, event);

  it("refuses to start a step before the one ahead of it passed", () => {
    expect(refuse(initialState(steps), "billing", { type: "start" })).toEqual({ ok: false, reason: '"init" has not passed yet' });
  });

  it("refuses an empty question, so asking can never leave the state inconsistent", () => {
    const running = run([["init", { type: "start" }]]);
    expect(refuse(running, "init", { type: "ask", question: "  " })).toEqual({ ok: false, reason: "a question cannot be empty" });
  });

  it("refuses an unknown step", () => {
    expect(refuse(initialState(steps), "nope", { type: "start" })).toEqual({ ok: false, reason: "unknown step" });
  });

  it("never lets a check pass a gated step that was not approved", () => {
    const held = run([
      ["init", { type: "start" }],
      ["init", passed()],
      ["billing", { type: "start" }],
    ]);
    expect(refuse(held, "billing", passed()).ok).toBe(false);
  });

  it("does not mutate the state it was given", () => {
    const state = initialState(steps);
    const snapshot = structuredClone(state);
    applyEvent(steps, state, "init", { type: "start" });
    expect(state).toEqual(snapshot);
  });

  // Every (status, event) pair outside the rule table must be refused.
  const ALLOWED = new Set([
    "pending:start",
    "awaiting-approval:approve",
    "awaiting-approval:reject",
    "running:ask",
    "awaiting-answer:answer",
    "running:check",
    "failed:retry",
  ]);
  const EVENTS: StepEvent[] = [
    { type: "start" },
    { type: "approve" },
    { type: "reject", reason: "r" },
    { type: "ask", question: "q" },
    { type: "answer", answer: "a", atMs: 1 },
    passed(),
    { type: "retry" },
  ];
  const pairs = STEP_STATUSES.flatMap((status) => EVENTS.map((event): [StepStatus, StepEvent] => [status, event]));

  it.each(pairs)("%s + %o follows the rule table", (status, event) => {
    const base = initialState(steps);
    const state: BlueprintState = { steps: { ...base.steps, init: { status, approved: false, answers: [], question: "q" } } };
    expect(applyEvent(steps, state, "init", event).ok).toBe(ALLOWED.has(`${status}:${event.type}`));
  });
});

describe("stateProblems — a loaded state that applyEvent could not have produced", () => {
  const withStep = (id: string, patch: Partial<BlueprintState["steps"][string]>): BlueprintState => {
    const state = initialState(steps);
    return { steps: { ...state.steps, [id]: { ...state.steps[id], ...patch } } };
  };

  it("finds nothing wrong with the initial state", () => {
    expect(stateProblems(steps, initialState(steps))).toEqual([]);
  });

  it("flags a gated step past its gate without approval", () => {
    const state = withStep("billing", { status: "running" });
    const tampered: BlueprintState = {
      steps: { ...state.steps, init: { ...state.steps.init, status: "passed", lastCheck: { ok: true, output: "", atMs: 1 } } },
    };
    expect(stateProblems(steps, tampered)).toEqual(['"billing" is running without approval']);
  });

  it("flags a later step started while an earlier one has not passed", () => {
    expect(stateProblems(steps, withStep("billing", { status: "running", approved: true }))).toEqual([
      '"billing" is running before the steps ahead of it passed',
    ]);
  });

  it("flags a missing and an unknown step", () => {
    const rest = Object.fromEntries(Object.entries(initialState(steps).steps).filter(([id]) => id !== "deploy"));
    expect(stateProblems(steps, { steps: { ...rest, stray: { status: "pending", approved: false, answers: [] } } })).toEqual([
      'state has unknown step "stray"',
      'no state for step "deploy"',
    ]);
  });

  it("flags a step marked passed without a passing check", () => {
    expect(stateProblems(steps, withStep("init", { status: "passed" }))).toEqual(['"init" passed without a passing check']);
    expect(stateProblems(steps, withStep("init", { status: "passed", lastCheck: { ok: false, output: "", atMs: 1 } }))).toEqual([
      '"init" passed without a passing check',
    ]);
  });

  it("flags waiting on an answer to no question", () => {
    expect(stateProblems(steps, withStep("init", { status: "awaiting-answer" }))).toEqual(['"init" awaits an answer to no question']);
  });

  // A hand-edited state.json is refused rather than acted on, so a later step cannot be passed
  // by a check while an earlier one is not.
  it("makes applyEvent refuse an inconsistent state", () => {
    const tampered = withStep("billing", { status: "running", approved: true });
    expect(applyEvent(steps, tampered, "billing", passed()).ok).toBe(false);
  });
});

describe("isAgentEvent", () => {
  it("lets the agent ask, and nothing else", () => {
    const events: StepEvent[] = [{ type: "ask", question: "q" }, { type: "approve" }, passed(), { type: "answer", answer: "a", atMs: 1 }, { type: "start" }];
    expect(events.filter(isAgentEvent).map((event) => event.type)).toEqual(["ask"]);
  });
});

describe("blueprintStateSchema", () => {
  it("round-trips the initial state", () => {
    const state = initialState(steps);
    expect(blueprintStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it.each([
    ["an unknown status", { steps: { init: { status: "sleeping" } } }],
    ["no steps map", {}],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    expect(blueprintStateSchema.safeParse(input).success).toBe(false);
  });
});
