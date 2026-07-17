import { describe, it, expect } from "vitest.js";
import { rollupCiState, normalizePr } from "../../../server/git/prs.js";

describe("rollupCiState", () => {
  it("is none for an empty / non-array rollup", () => {
    expect(rollupCiState([])).toBe("none");
    expect(rollupCiState(null)).toBe("none");
    expect(rollupCiState(undefined)).toBe("none");
  });
  it("is passing when every check succeeded (CheckRun conclusion + StatusContext state)", () => {
    expect(rollupCiState([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }, { conclusion: "SKIPPED" }])).toBe("passing");
  });
  it("is failing if any check failed (conclusion or state)", () => {
    expect(rollupCiState([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }])).toBe("failing");
    expect(rollupCiState([{ state: "ERROR" }])).toBe("failing");
    expect(rollupCiState([{ conclusion: "SUCCESS" }, { conclusion: "TIMED_OUT" }])).toBe("failing");
  });
  it("is pending when a non-failing check is not yet successful", () => {
    expect(rollupCiState([{ status: "IN_PROGRESS", conclusion: "" }, { conclusion: "SUCCESS" }])).toBe("pending");
    expect(rollupCiState([{ state: "PENDING" }])).toBe("pending");
  });
});

describe("normalizePr", () => {
  it("normalizes a gh pr json object and rolls up CI", () => {
    expect(
      normalizePr({
        number: 7,
        title: "fix things",
        author: { login: "alice" },
        updatedAt: "2026-07-03T00:00:00Z",
        isDraft: true,
        url: "https://github.com/o/r/pull/7",
        reviewDecision: "APPROVED",
        statusCheckRollup: [{ conclusion: "SUCCESS" }],
      }),
    ).toEqual({
      number: 7,
      title: "fix things",
      author: "alice",
      updatedAt: "2026-07-03T00:00:00Z",
      isDraft: true,
      url: "https://github.com/o/r/pull/7",
      review: "APPROVED",
      ci: "passing",
    });
  });
  it("returns null for a malformed entry (no number / url)", () => {
    expect(normalizePr({ title: "x" })).toBeNull();
    expect(normalizePr(null)).toBeNull();
  });
  it("defaults missing optional fields (author/review/draft)", () => {
    expect(normalizePr({ number: 1, url: "u" })).toEqual({
      number: 1,
      title: "",
      author: "",
      updatedAt: "",
      isDraft: false,
      url: "u",
      review: null,
      ci: "none",
    });
  });
});
