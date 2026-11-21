// The repeated-instruction wire types and the turn that starts the skill (#3334).
import { describe, expect, it } from "vitest";
import { isRepeatCandidate, isRepeatDetail, isRepeatId, isRepeatTarget, repeatTurn } from "../../common/libraryRepeats";

const candidate = { id: "0123456789abcdef", text: "merge", variants: ["merge"], count: 3, sessions: 2, projects: ["/w"], lastAt: 1 };

describe("repeatTurn", () => {
  it("is the skill's command for a target and a hex id, and null for anything else as the id", () => {
    expect(repeatTurn("rule", "0123456789abcdef")).toBe("/mulmoterminal-library repeat rule 0123456789abcdef");
    ["", "0123456789abcde", "0123456789abcdef0", "0123456789ABCDEF", "../../etc/passwd", "0123456789abcdeg", "0123456789abcdef\n"].forEach((id) =>
      expect(repeatTurn("skill", id)).toBeNull(),
    );
    expect(isRepeatId("fedcba9876543210")).toBe(true);
  });

  it("takes rule and skill as targets, and nothing else", () => {
    expect(["rule", "skill"].map(isRepeatTarget)).toEqual([true, true]);
    expect(["memory", "plan", "", null, 3].map(isRepeatTarget)).toEqual([false, false, false, false, false]);
  });
});

describe("the guards", () => {
  it("take a whole candidate and a detail, and refuse a malformed one", () => {
    expect(isRepeatCandidate(candidate)).toBe(true);
    expect(isRepeatDetail({ ...candidate, occurrences: [{ sessionId: "s", project: null, at: 1, text: "merge" }] })).toBe(true);
    [null, {}, { ...candidate, count: "3" }, { ...candidate, variants: [1] }, { ...candidate, projects: null }].forEach((value) =>
      expect(isRepeatCandidate(value)).toBe(false),
    );
    expect(isRepeatDetail(candidate)).toBe(false);
    expect(isRepeatDetail({ ...candidate, occurrences: [{ sessionId: "s", project: 3, at: 1, text: "x" }] })).toBe(false);
  });
});
