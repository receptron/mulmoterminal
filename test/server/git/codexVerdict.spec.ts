// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GH_LIST_ITEM_CAP, codexReviewOf, parseVerdictLine } from "../../../server/git/codexVerdict";

const HEAD = "e1f77995f0ce3800f325562c134fa5fb6d769378";

const comment = (body: string, createdAt: string, authorAssociation = "MEMBER") => ({ body, createdAt, authorAssociation });

describe("parseVerdictLine", () => {
  it("reads both verdicts, with and without the head they name", () => {
    expect(parseVerdictLine("CODEX VERDICT: LGTM (head e1f7799)\n- none")).toEqual({ verdict: "lgtm", sha: "e1f7799" });
    expect(parseVerdictLine("CODEX VERDICT: CHANGES REQUESTED (head E1F77995F)\n- P2: x")).toEqual({ verdict: "changes", sha: "e1f77995f" });
    expect(parseVerdictLine("CODEX VERDICT: LGTM")).toEqual({ verdict: "lgtm", sha: "" });
    expect(parseVerdictLine("codex verdict: changes requested  \r")).toEqual({ verdict: "changes", sha: "" });
  });

  it("reads the verdict whatever follows it on the line, and a malformed head as none named", () => {
    expect(parseVerdictLine("CODEX VERDICT: CHANGES REQUESTED\\n\\n- P2: x")).toEqual({ verdict: "changes", sha: "" });
    expect(parseVerdictLine("CODEX VERDICT: LGTM, mostly")).toEqual({ verdict: "lgtm", sha: "" });
    expect(parseVerdictLine("CODEX VERDICT: LGTM (head abc)")?.sha).toBe("");
    expect(parseVerdictLine("CODEX VERDICT: LGTM (head not-a-sha)")?.sha).toBe("");
    expect(parseVerdictLine(`CODEX VERDICT: LGTM (head ${"a".repeat(41)})`)?.sha).toBe("");
  });

  it("is null for anything that is not a verdict on the first line", () => {
    ["", "LGTM", "## Codex exchange — iteration 1\nCODEX VERDICT: LGTM", "CODEX VERDICT: MAYBE", "CODEX VERDICT: LGTMX", " CODEX VERDICT: LGTM"].forEach(
      (body) => expect(parseVerdictLine(body), body).toBeNull(),
    );
  });
});

describe("codexReviewOf", () => {
  it("counts every verdict and reports the newest, whichever list it came from", () => {
    const comments = [
      comment("CODEX VERDICT: CHANGES REQUESTED (head 8b0efda)", "2026-10-26T04:45:55Z"),
      comment("## Codex exchange — iteration 1", "2026-10-26T04:50:24Z"),
      comment("CODEX VERDICT: LGTM (head 8b0efda)", "2026-10-26T04:51:10Z"),
    ];
    const reviews = [{ body: "CODEX VERDICT: CHANGES REQUESTED (head e1f7799)", submittedAt: "2026-10-26T04:58:00Z", authorAssociation: "OWNER" }];
    expect(codexReviewOf(comments, reviews, HEAD)).toEqual({ verdicts: 3, more: false, latest: "changes", head: "current", lgtmOnHead: 0 });
  });

  it("says whether the newest verdict is for this head, another one, or none it names", () => {
    const one = (body: string) => codexReviewOf([comment(body, "2026-10-26T04:00:00Z")], [], HEAD)?.head;
    expect(one(`CODEX VERDICT: LGTM (head ${HEAD})`)).toBe("current");
    expect(one("CODEX VERDICT: LGTM (head 8b0efda)")).toBe("stale");
    expect(one("CODEX VERDICT: LGTM")).toBe("unknown");
    expect(codexReviewOf([comment("CODEX VERDICT: LGTM (head e1f7799)", "t")], [], "")?.head).toBe("stale");
  });

  it("counts the LGTMs naming this head, from either verdict line, and nothing else", () => {
    const comments = [
      comment(`REVIEW VERDICT: LGTM (head ${HEAD})`, "2026-10-26T04:00:00Z"),
      comment(`CODEX VERDICT: LGTM (head ${HEAD.slice(0, 7)})`, "2026-10-26T04:01:00Z"),
      comment(`CODEX VERDICT: CHANGES REQUESTED (head ${HEAD})`, "2026-10-26T04:02:00Z"),
      comment("CODEX VERDICT: LGTM (head e1f7799)", "2026-10-26T04:03:00Z"),
      comment("REVIEW VERDICT: LGTM", "2026-10-26T04:04:00Z"),
      comment(`REVIEW VERDICT: LGTM (head ${HEAD})`, "2026-10-26T04:05:00Z", "NONE"),
    ];
    expect(codexReviewOf(comments, [], HEAD)?.lgtmOnHead).toBe(2);
  });

  it("counts only the repo's own people", () => {
    const comments = ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "", "COLLABORATOR"].map((association) =>
      comment("CODEX VERDICT: LGTM", "2026-10-26T04:00:00Z", association),
    );
    expect(codexReviewOf(comments, [], HEAD)?.verdicts).toBe(1);
    expect(codexReviewOf([comment("CODEX VERDICT: LGTM", "t", "NONE")], [], HEAD)).toBeNull();
  });

  it("flags a comment or review list that reached gh's cap", () => {
    const filler = Array.from({ length: GH_LIST_ITEM_CAP - 1 }, () => comment("hi", "2026-10-26T03:00:00Z"));
    const capped = [...filler, comment("CODEX VERDICT: LGTM", "2026-10-26T04:00:00Z")];
    expect(codexReviewOf(capped, [], HEAD)?.more).toBe(true);
    expect(codexReviewOf(capped.slice(1), [], HEAD)?.more).toBe(false);
    const verdict = [comment("CODEX VERDICT: LGTM", "2026-10-26T04:00:00Z")];
    expect(codexReviewOf(verdict, filler, HEAD)?.more).toBe(false);
    expect(codexReviewOf(verdict, [...filler, filler[0]], HEAD)?.more).toBe(true);
  });

  it("does not count a verdict with no time, such as a review saved but not submitted", () => {
    const posted = comment("CODEX VERDICT: CHANGES REQUESTED", "2026-10-26T04:00:00Z");
    const pending = { body: "CODEX VERDICT: LGTM", submittedAt: null, authorAssociation: "OWNER" };
    expect(codexReviewOf([posted], [pending], HEAD)).toEqual({ verdicts: 1, more: false, latest: "changes", head: "unknown", lgtmOnHead: 0 });
    expect(codexReviewOf([], [pending, { ...pending, submittedAt: "" }], HEAD)).toBeNull();
    expect(codexReviewOf([{ ...posted, createdAt: undefined }], [], HEAD)).toBeNull();
  });

  it("is null when the comments were not read, even with a verdict in the reviews", () => {
    const review = { body: "CODEX VERDICT: LGTM", submittedAt: "2026-10-26T04:00:00Z", authorAssociation: "OWNER" };
    expect(codexReviewOf([], [review], HEAD)?.verdicts).toBe(1);
    [undefined, null, {}, "x"].forEach((comments) => expect(codexReviewOf(comments, [review], HEAD)).toBeNull());
  });

  it("is null when nothing usable was posted, whatever the shape", () => {
    [undefined, null, "x", {}, [], [null, 1, "x", { body: 5 }, { body: "CODEX VERDICT: LGTM" }]].forEach((comments) =>
      expect(codexReviewOf(comments, comments, HEAD)).toBeNull(),
    );
  });
});
