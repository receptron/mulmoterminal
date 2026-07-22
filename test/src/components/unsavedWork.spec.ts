import { describe, it, expect } from "vitest";

import { unsavedWork } from "../../../src/components/unsavedWork";

describe("unsavedWork", () => {
  // The reassuring case: nothing to lose, so the dialog's button reads "Remove worktree".
  it("reports nothing to lose on a clean, pushed worktree", () => {
    expect(unsavedWork({ ahead: 0, dirty: 0 })).toEqual({ has: false, summary: "" });
  });

  it("counts uncommitted changes", () => {
    expect(unsavedWork({ ahead: 0, dirty: 5 })).toEqual({ has: true, summary: "5 uncommitted changes" });
  });

  it("counts unpushed commits", () => {
    expect(unsavedWork({ ahead: 3, dirty: 0 })).toEqual({ has: true, summary: "3 unpushed commits" });
  });

  // Unpushed commits lead: they are the harder loss to recover from.
  it("names both, commits first", () => {
    expect(unsavedWork({ ahead: 2, dirty: 4 }).summary).toBe("2 unpushed commits + 4 uncommitted changes");
  });

  it("says it in the singular for exactly one", () => {
    expect(unsavedWork({ ahead: 1, dirty: 1 }).summary).toBe("1 unpushed commit + 1 uncommitted change");
  });

  // A single change is still work. An off-by-one here is the difference between a warning
  // and a button that says the room is clean.
  it("warns for a single uncommitted change", () => {
    expect(unsavedWork({ ahead: 0, dirty: 1 }).has).toBe(true);
  });

  // The diff is null until its fetch lands, and either count can be absent.
  it.each([[null], [undefined], [{}], [{ ahead: 0 }], [{ dirty: 0 }]])("treats %j as nothing known yet", (diff) => {
    expect(unsavedWork(diff)).toEqual({ has: false, summary: "" });
  });

  // `has` and `summary` used to be two independent computeds; a single source is what keeps
  // "there is unsaved work" from ever pairing with an empty sentence.
  it.each([
    [0, 0],
    [1, 0],
    [0, 1],
    [7, 9],
  ])("keeps the flag and the sentence agreeing (ahead=%i dirty=%i)", (ahead, dirty) => {
    const { has, summary } = unsavedWork({ ahead, dirty });
    expect(has).toBe(summary.length > 0);
  });

  // Guard against a negative count from a miscomputed diff reading as work to lose.
  it("does not treat a negative count as work", () => {
    expect(unsavedWork({ ahead: -1, dirty: -2 })).toEqual({ has: false, summary: "" });
  });
});
