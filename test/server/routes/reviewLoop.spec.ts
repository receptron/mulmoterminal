// @vitest-environment node
// The review loop's rules (#3409): when a round may start, what the reviewer is asked, and what the
// author is told — in particular that "merge condition met" needs the declared LGTMs on the CURRENT
// head and every CI check passing, and nothing less.
import { describe, it, expect } from "vitest";
import {
  lgtmCountOn,
  loopKey,
  parseEndRequest,
  parseReviewRequest,
  reviewPrompt,
  roundEndMessage,
  roundRefusal,
  type ReviewLoop,
  type ReviewRound,
} from "../../../server/routes/reviewLoop.js";
import { REVIEW_DEFAULTS, type ReviewSettings } from "../../../common/reviewSettings.js";
import { SEND_MAX_CHARS } from "../../../server/routes/sessionAsk.js";
import { parseVerdictLine } from "../../../server/git/codexVerdict.js";

const AUTHOR = "0b7d2c1e-1111-4222-8333-944455556666";
const REVIEWER = "1c8e3d2f-2222-4333-8444-a55566667777";
const OTHER = "2d9f4e30-3333-4444-8555-b66677778888";
const HEAD = "a".repeat(40);
const NEXT = "b".repeat(40);
const SETTINGS: ReviewSettings = { reviewer: "codex", maxRounds: 3, requiredLgtm: 1 };

const loopWith = (rounds: ReviewRound[], extra: Partial<ReviewLoop> = {}): ReviewLoop => ({
  repo: "owner/repo",
  pr: 7,
  author: AUTHOR,
  reviewer: REVIEWER,
  rounds,
  running: false,
  ...extra,
});
const request = { author: AUTHOR, reviewer: REVIEWER, head: HEAD };

describe("parseReviewRequest / parseEndRequest", () => {
  it("accepts a repository, a PR number and a reviewer session", () => {
    expect(parseReviewRequest({ repo: " owner/repo ", pr: 7, reviewer: REVIEWER })).toEqual({ ok: true, repo: "owner/repo", pr: 7, reviewer: REVIEWER });
    expect(parseEndRequest({ repo: "owner/repo", pr: 7 })).toEqual({ ok: true, repo: "owner/repo", pr: 7 });
  });

  it.each([
    [undefined],
    [{}],
    [{ repo: "owner/repo" }],
    [{ repo: "not a repo", pr: 7 }],
    [{ repo: "owner/repo", pr: "7" }],
    [{ repo: "owner/repo", pr: 0 }],
    [{ repo: "owner/repo", pr: 1.5 }],
    [{ repo: 1, pr: 7 }],
  ])("refuses a request without a PR: %j", (body) => {
    expect(parseReviewRequest({ ...(body ?? {}), reviewer: REVIEWER }).ok).toBe(false);
    expect(parseEndRequest(body).ok).toBe(false);
  });

  it.each([[undefined], [""], ["not-a-session"], [42]])("refuses a reviewer that is not a session id: %j", (reviewer) => {
    expect(parseReviewRequest({ repo: "owner/repo", pr: 7, reviewer })).toMatchObject({ ok: false, error: expect.stringMatching(/reviewer/) });
  });
});

describe("loopKey", () => {
  it("is one loop per PR, whatever case the repository is written in", () => {
    expect(loopKey({ repo: "Owner/Repo", pr: 7 })).toBe(loopKey({ repo: "owner/repo", pr: 7 }));
    expect(loopKey({ repo: "owner/repo", pr: 7 })).not.toBe(loopKey({ repo: "owner/repo", pr: 8 }));
  });
});

describe("roundRefusal", () => {
  it("lets the first round start", () => {
    expect(roundRefusal(undefined, request, SETTINGS)).toBeNull();
  });

  it("lets a new head be reviewed after changes were requested", () => {
    expect(roundRefusal(loopWith([{ head: NEXT, verdict: "changes" }]), request, SETTINGS)).toBeNull();
  });

  it("lets a head be asked about again when the last round gave no verdict", () => {
    expect(roundRefusal(loopWith([{ head: HEAD, verdict: null }]), request, SETTINGS)).toBeNull();
  });

  it("lets a head with fewer LGTMs than required be reviewed again", () => {
    expect(roundRefusal(loopWith([{ head: HEAD, verdict: "lgtm" }]), request, { ...SETTINGS, requiredLgtm: 2 })).toBeNull();
  });

  it.each<[string, ReviewLoop, RegExp]>([
    ["another author's loop", loopWith([], { author: OTHER }), /Another session/],
    ["another reviewer on the PR", loopWith([], { reviewer: OTHER }), /one reviewer stays with one PR/],
    ["a round still running", loopWith([], { running: true }), /still running/],
    [
      "the round limit",
      loopWith([
        { head: "c", verdict: "changes" },
        { head: "d", verdict: "changes" },
        { head: "e", verdict: "changes" },
      ]),
      /Ask the user/,
    ],
    ["the same head turned down", loopWith([{ head: HEAD, verdict: "changes" }]), /push before asking again/],
    ["a head that already has its LGTMs", loopWith([{ head: HEAD, verdict: "lgtm" }]), /nothing more to review/],
  ])("refuses %s", (_label, loop, reason) => {
    expect(roundRefusal(loop, request, SETTINGS)).toMatch(reason);
  });
});

describe("lgtmCountOn", () => {
  it("counts only LGTMs naming that head", () => {
    const rounds: ReviewRound[] = [
      { head: HEAD, verdict: "lgtm" },
      { head: NEXT, verdict: "lgtm" },
      { head: HEAD, verdict: "changes" },
      { head: HEAD, verdict: null },
      { head: HEAD, verdict: "lgtm" },
    ];
    expect(lgtmCountOn(rounds, HEAD)).toBe(2);
    expect(lgtmCountOn(rounds, "c")).toBe(0);
  });
});

describe("reviewPrompt", () => {
  const facts = { repo: "owner/repo", pr: 7, head: HEAD, round: 1, maxRounds: REVIEW_DEFAULTS.maxRounds };

  it("names the PR, the head, and both verdict lines in a form the parser reads", () => {
    const prompt = reviewPrompt(facts);
    expect(prompt).toContain(`gh pr diff 7 -R owner/repo`);
    expect(prompt).toContain(HEAD);
    const lines = [...prompt.matchAll(/REVIEW VERDICT: [A-Z ]+ \(head [0-9a-f]+\)/g)].map((match) => match[0]);
    expect(lines.map((line) => parseVerdictLine(line))).toEqual([
      { verdict: "lgtm", sha: HEAD },
      { verdict: "changes", sha: HEAD },
    ]);
  });

  it("asks a later round to check the fixes and flag repeats", () => {
    expect(reviewPrompt(facts)).not.toMatch(/repeats/);
    expect(reviewPrompt({ ...facts, round: 2 })).toMatch(/repeats one you raised before/);
  });

  it("fits what one send may carry, at the longest a repository name can be", () => {
    const longest = reviewPrompt({ ...facts, repo: `${"o".repeat(39)}/${"r".repeat(100)}`, pr: 999_999, round: 50, maxRounds: 50 });
    expect(longest.length).toBeLessThanOrEqual(SEND_MAX_CHARS);
    expect(longest).not.toMatch(/\n/);
  });
});

describe("roundEndMessage", () => {
  const ended = (rounds: ReviewRound[], now: { head: string; ci: "passing" | "pending" | "failing" | "none" } | null, timedOut = false, settings = SETTINGS) =>
    roundEndMessage({ loop: loopWith(rounds), settings, now, timedOut });

  it("says the merge condition is met only with the LGTMs on the current head and CI passing", () => {
    const message = ended([{ head: HEAD, verdict: "lgtm" }], { head: HEAD, ci: "passing" });
    expect(message).toMatch(/Merge condition met: 1\/1 LGTM on the current head/);
    expect(message).toMatch(/endReview/);
  });

  it.each<["passing" | "pending" | "failing" | "none", RegExp]>([
    ["pending", /CI is pending: merge once every check passes/],
    ["failing", /CI is failing: merge once every check passes/],
    ["none", /no CI checks are reported yet/],
  ])("holds the merge back while CI is %s", (ci, reason) => {
    const message = ended([{ head: HEAD, verdict: "lgtm" }], { head: HEAD, ci });
    expect(message).toMatch(reason);
    expect(message).not.toMatch(/Merge condition met/);
  });

  it("asks for another review while the LGTMs fall short", () => {
    const message = ended([{ head: HEAD, verdict: "lgtm" }], { head: HEAD, ci: "passing" }, false, { ...SETTINGS, requiredLgtm: 2 });
    expect(message).toMatch(/1\/2 LGTM.*requestReview again/);
  });

  it("does not count an LGTM for a head the PR has moved past", () => {
    const message = ended([{ head: HEAD, verdict: "lgtm" }], { head: NEXT, ci: "passing" });
    expect(message).toMatch(/moved to bbbbbbb since/);
    expect(message).toMatch(/0\/1 LGTM/);
    expect(message).not.toMatch(/Merge condition met/);
  });

  it("will not call it mergeable when the PR could not be read", () => {
    const message = ended([{ head: HEAD, verdict: "lgtm" }], null);
    expect(message).toMatch(/could not be read/);
    expect(message).not.toMatch(/Merge condition met/);
  });

  it("sends the author to the findings on changes requested, with the rounds left", () => {
    const message = ended([{ head: HEAD, verdict: "changes" }], { head: HEAD, ci: "passing" });
    expect(message).toMatch(/CHANGES REQUESTED on head aaaaaaa/);
    expect(message).toContain(`waitForSessionReply {"session":"${REVIEWER}"}`);
    expect(message).toMatch(/2 rounds left/);
  });

  it("says when that was the last round", () => {
    const rounds: ReviewRound[] = [
      { head: "c", verdict: "changes" },
      { head: "d", verdict: "changes" },
      { head: HEAD, verdict: "changes" },
    ];
    expect(ended(rounds, { head: HEAD, ci: "passing" })).toMatch(/last round this repository allows/);
  });

  it("tells a reply without a verdict, and a reviewer that never answered, apart", () => {
    expect(ended([{ head: HEAD, verdict: null }], { head: HEAD, ci: "passing" })).toMatch(/no verdict on head.*no REVIEW VERDICT line/);
    expect(ended([{ head: HEAD, verdict: null }], { head: HEAD, ci: "passing" }, true)).toMatch(/no answer on head.*has not answered in 60 minutes/);
  });

  it("is one line", () => {
    expect(ended([{ head: HEAD, verdict: "changes" }], { head: HEAD, ci: "passing" })).not.toMatch(/\n/);
  });
});
