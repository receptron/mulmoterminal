// @vitest-environment node
// The one step the skill evaluation panel points at (#3466), in every state the panel can be in: no tasks,
// nothing measured, a verdict either way, an improvement that did or did not pass more, a search done.
import { describe, it, expect } from "vitest";
import { skillEvalNext } from "../../../src/components/skillEvalNext";
import type { SkillEvalAttempt, SkillEvalCase, SkillEvalOverview, SkillEvalRun, SkillEvalSet } from "../../../common/skillEval";

const useCase: SkillEvalCase = { id: "a", title: "A", kind: "use", prompt: "p", check: { type: "command", command: "true" } };
const set: SkillEvalSet = {
  ...{ version: 1, skill: "weekly", model: "haiku", judgeModel: "haiku", improveModel: "sonnet", ladder: ["haiku", "sonnet"], repeats: 2 },
  ...{ maxBudgetUsdPerAttempt: 0.5, allowedTools: [], cases: [useCase] },
};

const attempt = (arm: "with" | "without", round: number, pass: boolean, model = "haiku"): SkillEvalAttempt => ({
  ...{ caseId: "a", arm, round, pass, skillInvoked: arm === "with", costUsd: 0.01, gradingCostUsd: 0, durationMs: 1 },
  ...{ finalText: "", checkOutput: "", denied: [], error: null, model, reusedFrom: "" },
});

/** A finished run whose rounds pass with and without the skill as given. */
function run(id: string, withPasses: boolean[], withoutPasses: boolean[], extra: Partial<SkillEvalRun> = {}): SkillEvalRun {
  const attempts = [...withPasses.map((pass, round) => attempt("with", round, pass)), ...withoutPasses.map((pass, round) => attempt("without", round, pass))];
  return {
    ...{ id, skill: "weekly", status: "done", startedAt: 1, finishedAt: 2, model: "haiku", repeats: 2, skillText: "x", skillHash: "h", setHash: "s" },
    ...{ cases: [useCase], plannedAttempts: attempts.length, attempts, candidateId: null, note: "", improveCostUsd: 0 },
    ...{ baseSkillHash: "", baseRunId: null, ladder: [], interruptedBy: "" },
    ...extra,
  };
}

const helps = run("1-base", [true, true], [false, false]);
const noEvidence = run("1-base", [false, true], [false, true]);
const improvement = (passes: boolean[], extra: Partial<SkillEvalRun> = {}): SkillEvalRun =>
  run("2-cand", passes, [false, true], { candidateId: "2-cand", baseRunId: "1-base", skillHash: "c", ...extra });
const search = (extra: Partial<SkillEvalRun> = {}): SkillEvalRun => run("3-ladder", [true, true], [], { ladder: ["haiku", "sonnet"], ...extra });

function overview(baseline: SkillEvalRun | null, runs: SkillEvalRun[], extra: Partial<SkillEvalOverview> = {}): SkillEvalOverview {
  return {
    ...{ skill: "weekly", dir: "/d", set, setHash: "s", skillHash: "h", setError: null, editable: true, baseline, runs, activeRunId: null },
    estimate: { attempts: 4, maxCostUsd: 2, improveAttempts: 2, maxImproveCostUsd: 3, ladderAttempts: 4, maxLadderCostUsd: 2 },
    ...extra,
  };
}

describe("the next step", () => {
  it("is drafting tasks while there are none, with no reason line: the panel says what it is", () => {
    expect(skillEvalNext(overview(null, [], { set: null, setHash: null, estimate: null }))).toEqual({ step: "draft", reason: null });
  });

  it("is nothing while a run goes on", () => {
    expect(skillEvalNext(overview(null, [run("1", [], [], { status: "running" })], { activeRunId: "1" }))).toEqual({ step: null, reason: null });
  });

  it("is measuring when the skill and tasks as they are now have not been measured", () => {
    expect(skillEvalNext(overview(null, []))).toEqual({ step: "measure", reason: "measure" });
    // An older measurement of other text, or of other tasks, is not one of these.
    expect(skillEvalNext(overview(null, [run("0", [true, true], [false, false], { skillHash: "old" })]))).toMatchObject({ step: "measure" });
  });

  it("is improving when there is no evidence the skill helps, or it makes things worse", () => {
    expect(skillEvalNext(overview(noEvidence, [noEvidence]))).toEqual({ step: "improve", reason: "improve" });
    const hurts = run("1-base", [false, false], [true, true]);
    expect(skillEvalNext(overview(hurts, [hurts]))).toEqual({ step: "improve", reason: "improve" });
  });

  it("is adopting an improvement on screen that passed more than the skill by more than chance, whatever its verdict", () => {
    const better = improvement([true, true]);
    const steady = run("1-base", [false, false], [false, false]);
    expect(skillEvalNext(overview(steady, [better, steady]))).toEqual({ step: "adopt", reason: "adopt" });
    const hurts = run("1-base", [false, false], [true, true]);
    expect(skillEvalNext(overview(hurts, [better]))).toMatchObject({ step: "adopt" });
  });

  it("is improving again after an improvement that passed more only by as much as the skill's own rounds move", () => {
    // The baseline's rounds passed 0 and 1: an improvement passing both is within that.
    expect(skillEvalNext(overview(noEvidence, [improvement([true, true]), noEvidence]))).toEqual({ step: "improve", reason: "improveAgain" });
  });

  it("is improving again, saying why, after an improvement that did not pass more", () => {
    expect(skillEvalNext(overview(noEvidence, [improvement([false, true]), noEvidence]))).toEqual({ step: "improve", reason: "improveAgain" });
    expect(skillEvalNext(overview(noEvidence, [improvement([false, false]), noEvidence]))).toMatchObject({ reason: "improveAgain" });
  });

  it("does not count an improvement that is unfinished, failed to be written, or measured other tasks", () => {
    const unusable: Partial<SkillEvalRun>[] = [{ status: "stopped" }, { status: "interrupted", skillText: "" }, { setHash: "other tasks" }];
    for (const extra of unusable) {
      expect(skillEvalNext(overview(noEvidence, [improvement([true, true], extra), noEvidence]))).toEqual({ step: "improve", reason: "improve" });
    }
  });

  it("does not point at adopting an improvement that is no longer the run on screen", () => {
    const later = run("4-again", [false, true], [false, true]);
    expect(skillEvalNext(overview(noEvidence, [later, improvement([true, true]), noEvidence]))).toMatchObject({ step: "improve", reason: "improveAgain" });
  });

  it("is searching for a cheaper model once the skill helps, and nothing once that search is done", () => {
    expect(skillEvalNext(overview(helps, [helps]))).toEqual({ step: "ladder", reason: "ladder" });
    expect(skillEvalNext(overview(helps, [search(), helps]))).toEqual({ step: null, reason: "done" });
  });

  it("still offers the search when the one done was stopped, or searched other text or tasks", () => {
    const unusable: Partial<SkillEvalRun>[] = [{ status: "stopped" }, { skillHash: "old" }, { setHash: "other tasks" }];
    for (const extra of unusable) {
      expect(skillEvalNext(overview(helps, [search(extra), helps]))).toMatchObject({ step: "ladder" });
    }
  });

  it("offers no search when no task is one the skill should help with", () => {
    const estimate = { attempts: 2, maxCostUsd: 1, improveAttempts: 1, maxImproveCostUsd: 2, ladderAttempts: 0, maxLadderCostUsd: 0 };
    expect(skillEvalNext(overview(helps, [helps], { estimate }))).toEqual({ step: null, reason: null });
  });

  it("points at nothing it could not write for a skill that cannot be edited here", () => {
    expect(skillEvalNext(overview(noEvidence, [noEvidence], { editable: false }))).toEqual({ step: null, reason: null });
    expect(skillEvalNext(overview(noEvidence, [improvement([true, true]), noEvidence], { editable: false }))).toEqual({ step: null, reason: null });
    // What it can do, it still points at.
    expect(skillEvalNext(overview(helps, [helps], { editable: false }))).toMatchObject({ step: "ladder" });
  });

  it("is nothing when the measurement could not give a verdict", () => {
    const onlyWith = run("1-base", [true, true], []);
    expect(skillEvalNext(overview(onlyWith, [onlyWith]))).toEqual({ step: null, reason: null });
  });
});
