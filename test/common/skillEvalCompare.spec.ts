// Whether an improvement beats the measurement it was written from (#3529): better or worse only past the
// with-skill rounds' spread and one task's worth, the tasks it passed less often, and too little to compare.
import { describe, it, expect } from "vitest";
import { compareImprovement, type MeasuredSkill } from "../../common/skillEvalCompare";
import type { SkillEvalAttempt, SkillEvalCase } from "../../common/skillEval";

const useCase = (id: string): SkillEvalCase => ({ id, title: id, kind: "use", prompt: "p", check: { type: "command", command: "true" } });
const avoidCase: SkillEvalCase = { id: "avoid", title: "avoid", kind: "avoid", prompt: "p", check: { type: "rubric", items: ["x"] } };

const attempt = (caseId: string, round: number, pass: boolean, skillInvoked = true): SkillEvalAttempt => ({
  ...{ caseId, arm: "with", round, pass, skillInvoked, costUsd: 0, gradingCostUsd: 0, durationMs: 0 },
  ...{ finalText: "", checkOutput: "", denied: [], error: null, model: "haiku", reusedFrom: "" },
});

/** `rows[case][round]`: whether that with-skill attempt passed, for the use cases `ids`. */
function measured(ids: string[], rows: boolean[][], extra: SkillEvalAttempt[] = [], cases = ids.map(useCase)): MeasuredSkill {
  const attempts = rows.flatMap((rounds, c) => rounds.map((pass, round) => attempt(ids[c] ?? "", round, pass)));
  return { cases, attempts: [...attempts, ...extra], repeats: rows[0]?.length ?? 0 };
}

const three = ["board", "eval", "reading"];

describe("compareImprovement", () => {
  it("finds no evidence in the gain that the skill's own rounds already move by", () => {
    // product-article-ja: the rounds passed 1/3, 3/3 and 2/3 (6 of 9); the improvement passed 9 of 9.
    const baseline = measured(three, [
      [false, true, true],
      [false, true, false],
      [true, true, true],
    ]);
    const improvement = measured(three, [
      [true, true, true],
      [true, true, true],
      [true, true, true],
    ]);
    const comparison = compareImprovement(baseline, improvement);
    expect(comparison.change).toBe("no-evidence");
    expect(comparison.gap).toBeCloseTo(1 / 3);
    expect(comparison.spread).toBeCloseTo(2 / 3);
    expect(comparison.worseCaseIds).toEqual([]);
  });

  it("says better or worse once the gap is wider than either run's rounds disagree, and a task's worth", () => {
    const none = measured(three, [
      [false, false],
      [false, false],
      [false, false],
    ]);
    const all = measured(three, [
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(compareImprovement(none, all)).toMatchObject({ change: "better", gap: 1, spread: 0 });
    expect(compareImprovement(all, none)).toMatchObject({ change: "worse", worseCaseIds: three });
    // One task's worth more, as steady as the baseline: at the threshold, which counts.
    const oneMore = measured(three, [
      [true, true],
      [false, false],
      [false, false],
    ]);
    expect(compareImprovement(none, oneMore).change).toBe("better");
  });

  it("holds the gap against the noisier of the two runs", () => {
    const steady = measured(["a"], [[false, false]]);
    const noisy = measured(["a"], [[true, false]]);
    expect(compareImprovement(steady, noisy)).toMatchObject({ change: "no-evidence", spread: 1 });
    expect(compareImprovement(noisy, steady)).toMatchObject({ change: "no-evidence", spread: 1 });
  });

  it("counts a use task only when the skill was read, and an avoid task only when it was not", () => {
    const cases = [useCase("a"), avoidCase];
    const read = measured(["a"], [[true, true]], [attempt("avoid", 0, true, false), attempt("avoid", 1, true, false)], cases);
    const unread = measured(["a"], [[true, true]], [attempt("avoid", 0, true, true), attempt("avoid", 1, true, false)], cases);
    unread.attempts = unread.attempts.map((a) => (a.caseId === "a" ? { ...a, skillInvoked: false } : a));
    const comparison = compareImprovement(read, unread);
    expect(comparison).toMatchObject({ change: "worse", gap: -1 });
    expect(comparison.worseCaseIds).toEqual(["a", "avoid"]);
  });

  it("ignores the runs without the skill, and tasks only one run measured", () => {
    const baseline = measured(["a"], [[false, false]]);
    const improvement = measured(
      ["a", "b"],
      [
        [true, true],
        [true, true],
      ],
    );
    const without: SkillEvalAttempt = { ...attempt("a", 0, true), arm: "without" };
    baseline.attempts = [...baseline.attempts, without];
    expect(compareImprovement(baseline, improvement)).toMatchObject({ change: "better", worseCaseIds: [] });
  });

  it("is pending when either run has nothing to compare", () => {
    const empty: MeasuredSkill = { cases: [useCase("a")], attempts: [], repeats: 2 };
    expect(compareImprovement(empty, measured(["a"], [[true, true]]))).toMatchObject({ change: "pending", gap: null });
    expect(compareImprovement(measured(["a"], [[true, true]]), empty).change).toBe("pending");
    // Two rounds were asked for, but one ran: no spread to hold the gap against.
    expect(compareImprovement(measured(["a"], [[false, false]]), { ...measured(["a"], [[true]]), repeats: 2 }).change).toBe("pending");
    // One round was all there was to be: it cannot disagree with itself.
    expect(compareImprovement(measured(["a"], [[false]]), measured(["a"], [[true]])).change).toBe("better");
  });
});
