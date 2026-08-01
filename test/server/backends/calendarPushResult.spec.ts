// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { CalendarPushOutcome } from "@mulmoclaude/core/google";

import { PUSH_NOT_DECLARED_ERROR, PUSH_NOT_LINKED_ERROR, pushReadOnlyError, toCollectionPushResult } from "../../../server/backends/calendarPushResult.js";

// Four of the engine's five outcomes mean "the push did not run", and all four have to come
// back as `errors`: counts alone would render "0 created", which reads as "nothing to do"
// when the real answer is "your account isn't linked".
const refusals: Array<[label: string, outcome: CalendarPushOutcome, error: string]> = [
  ["an unlinked Google account", { kind: "not-linked" }, PUSH_NOT_LINKED_ERROR],
  ["a collection that declares no calendar", { kind: "not-a-calendar" }, PUSH_NOT_DECLARED_ERROR],
  ["a calendar the user can only read", { kind: "read-only", accessRole: "reader" }, pushReadOnlyError("reader")],
  ["an engine failure", { kind: "failed", message: "calendar API unreachable" }, "calendar API unreachable"],
];

describe("toCollectionPushResult", () => {
  it("carries a successful push's counts through", () => {
    const outcome: CalendarPushOutcome = {
      kind: "pushed",
      result: { slug: "meetings", created: 3, updated: 2, conflicts: 1, localDeletes: 4, skipped: ["r7: no start time"], errors: [] },
    };
    expect(toCollectionPushResult(outcome)).toEqual({
      pushed: true,
      created: 3,
      updated: 2,
      conflicts: 1,
      localDeletes: 4,
      skipped: ["r7: no start time"],
      errors: [],
      // `slug` and `unpushedIds` are the engine's, not the wire's — toEqual fails if either leaks through.
    });
  });

  // A push that reached Google but could not place every record is still a push: the counts
  // are real and the per-record reasons belong in `skipped`, not in `errors`.
  it("keeps per-record reasons on a push that partly succeeded", () => {
    const result = toCollectionPushResult({
      kind: "pushed",
      result: {
        slug: "meetings",
        created: 1,
        updated: 0,
        conflicts: 0,
        localDeletes: 0,
        skipped: ["r2: end before start"],
        errors: ["r9: 403"],
      },
    });
    expect(result.skipped).toEqual(["r2: end before start"]);
    expect(result.errors).toEqual(["r9: 403"]);
  });

  describe.each(refusals)("%s", (_label, outcome, error) => {
    it("reports zero movement and says why", () => {
      // Pinned whole: a refusal that leaked a non-zero count would claim work it never did.
      expect(toCollectionPushResult(outcome)).toEqual({
        pushed: true,
        created: 0,
        updated: 0,
        conflicts: 0,
        localDeletes: 0,
        skipped: [],
        errors: [error],
      });
    });
  });

  // `read-only` is the one refusal whose wording depends on the outcome: "reader" and
  // "freeBusyReader" are the difference between asking the owner for write access and
  // having the wrong calendar entirely, so the role has to survive into the message.
  it("names the access role, and stays readable when Google reports none", () => {
    expect(toCollectionPushResult({ kind: "read-only", accessRole: "freeBusyReader" }).errors[0]).toContain("freeBusyReader");
    expect(toCollectionPushResult({ kind: "read-only", accessRole: "" }).errors[0]).toBe(pushReadOnlyError(""));
    expect(pushReadOnlyError("")).toContain("read access");
  });

  // The refusals share one builder; a mutation on one must not reach the next.
  it("gives each refusal its own arrays", () => {
    const first = toCollectionPushResult({ kind: "not-linked" });
    first.errors.push("extra");
    first.skipped.push("extra");
    expect(toCollectionPushResult({ kind: "not-linked" }).errors).toEqual([PUSH_NOT_LINKED_ERROR]);
    expect(toCollectionPushResult({ kind: "not-linked" }).skipped).toEqual([]);
  });
});
