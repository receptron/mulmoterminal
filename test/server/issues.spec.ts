import { describe, it, expect } from "vitest";
import { normalizeIssue, ISSUE_LIMIT } from "../../server/issues";

describe("normalizeIssue", () => {
  it("normalizes a gh issue json object", () => {
    expect(
      normalizeIssue({
        number: 42,
        title: "flaky test",
        author: { login: "bob" },
        updatedAt: "2026-07-03T00:00:00Z",
        url: "https://github.com/o/r/issues/42",
      }),
    ).toEqual({
      number: 42,
      title: "flaky test",
      author: "bob",
      updatedAt: "2026-07-03T00:00:00Z",
      url: "https://github.com/o/r/issues/42",
    });
  });
  it("returns null for a malformed entry (no number / url)", () => {
    expect(normalizeIssue({ title: "x" })).toBeNull();
    expect(normalizeIssue(null)).toBeNull();
  });
  it("defaults missing optional fields (author/title/updatedAt)", () => {
    expect(normalizeIssue({ number: 1, url: "u" })).toEqual({
      number: 1,
      title: "",
      author: "",
      updatedAt: "",
      url: "u",
    });
  });
  it("keeps the per-repo cap small enough to stay a glanceable digest", () => {
    expect(ISSUE_LIMIT).toBeLessThanOrEqual(50);
  });
});
