// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";

import { derivePrPhase, parsePrView, phaseForRepoBranch, clearPrPhaseCache, type ParsedPr } from "../../../server/git/prPhase.js";

const pr = (over: Partial<ParsedPr> = {}): ParsedPr => ({ state: "OPEN", isDraft: false, reviewDecision: "", ci: "passing", ...over });

describe("derivePrPhase", () => {
  it("returns none when there is no PR", () => {
    expect(derivePrPhase(null)).toBe("none");
  });

  it.each([
    ["MERGED", "merged"],
    ["merged", "merged"],
    ["CLOSED", "closed"],
  ])("maps state %s to %s", (state, expected) => {
    expect(derivePrPhase(pr({ state }))).toBe(expected);
  });

  it("maps a draft PR to draft", () => {
    expect(derivePrPhase(pr({ isDraft: true }))).toBe("draft");
  });

  it("maps an open PR with failing CI to ci-failing", () => {
    expect(derivePrPhase(pr({ ci: "failing" }))).toBe("ci-failing");
  });

  it("maps an open PR with changes requested to changes-requested", () => {
    expect(derivePrPhase(pr({ reviewDecision: "CHANGES_REQUESTED", ci: "passing" }))).toBe("changes-requested");
  });

  it("maps an open PR with pending CI to ci-running", () => {
    expect(derivePrPhase(pr({ ci: "pending" }))).toBe("ci-running");
  });

  it.each([["passing"], ["none"]])("maps an open PR with %s CI and no blockers to ready", (ci) => {
    expect(derivePrPhase(pr({ ci: ci as ParsedPr["ci"] }))).toBe("ready");
  });

  // Precedence: the earliest-listed blocker wins so the roster shows what needs attention first.
  it("prefers draft over every open-state blocker", () => {
    expect(derivePrPhase(pr({ isDraft: true, ci: "failing", reviewDecision: "CHANGES_REQUESTED" }))).toBe("draft");
  });

  it("prefers failing CI over changes-requested", () => {
    expect(derivePrPhase(pr({ ci: "failing", reviewDecision: "CHANGES_REQUESTED" }))).toBe("ci-failing");
  });

  it("prefers changes-requested over still-pending CI", () => {
    expect(derivePrPhase(pr({ ci: "pending", reviewDecision: "CHANGES_REQUESTED" }))).toBe("changes-requested");
  });
});

describe("parsePrView", () => {
  it("parses the first PR and rolls up its CI", () => {
    const stdout = JSON.stringify([{ state: "OPEN", isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [{ conclusion: "SUCCESS" }] }]);
    expect(parsePrView(stdout)).toEqual({ state: "OPEN", isDraft: false, reviewDecision: "APPROVED", ci: "passing" });
  });

  it("rolls a mixed check set with a failure to failing", () => {
    const stdout = JSON.stringify([{ state: "OPEN", statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] }]);
    expect(parsePrView(stdout)?.ci).toBe("failing");
  });

  it("returns none-CI for an empty rollup", () => {
    expect(parsePrView(JSON.stringify([{ state: "OPEN", statusCheckRollup: [] }]))?.ci).toBe("none");
  });

  it.each([
    ["an empty array", "[]"],
    ["malformed JSON", "{ not json"],
    ["a non-array", '{"state":"OPEN"}'],
  ])("returns null for %s", (_label, stdout) => {
    expect(parsePrView(stdout)).toBeNull();
  });

  it("defaults missing string fields", () => {
    expect(parsePrView(JSON.stringify([{}]))).toEqual({ state: "", isDraft: false, reviewDecision: "", ci: "none" });
  });
});

describe("phaseForRepoBranch", () => {
  beforeEach(() => clearPrPhaseCache());

  const stubGh =
    (stdout: string, ok = true) =>
    async () => ({ ok, stdout, stderr: "" });

  const countingGh = (stdout: string) => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { ok: true, stdout, stderr: "" };
    };
    return { fn, calls: () => calls };
  };

  it("derives the phase and url from gh output", async () => {
    const stdout = JSON.stringify([{ state: "OPEN", isDraft: false, statusCheckRollup: [{ conclusion: "SUCCESS" }], url: "https://github.com/o/r/pull/1" }]);
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh: stubGh(stdout) });
    expect(result).toEqual({ phase: "ready", url: "https://github.com/o/r/pull/1" });
  });

  it("queries --state all so a merged branch reads as merged, not none", async () => {
    let args: string[] = [];
    const runGh = async (a: string[]) => {
      args = a;
      return { ok: true, stdout: JSON.stringify([{ state: "MERGED", url: "u" }]), stderr: "" };
    };
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh });
    expect(result.phase).toBe("merged");
    expect(args).toContain("all");
  });

  it("resolves to none when gh fails", async () => {
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh: stubGh("", false) });
    expect(result).toEqual({ phase: "none", url: null });
  });

  it("caches within the TTL (one gh call for two lookups)", async () => {
    const gh = countingGh(JSON.stringify([{ state: "OPEN", statusCheckRollup: [], url: "u" }]));
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => 1000, ttlMs: 30_000 });
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => 1000, ttlMs: 30_000 });
    expect(gh.calls()).toBe(1);
  });

  it("re-queries once the TTL has elapsed", async () => {
    const gh = countingGh(JSON.stringify([{ state: "OPEN", statusCheckRollup: [], url: "u" }]));
    let t = 1000;
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => t, ttlMs: 30_000 });
    t = 1000 + 31_000;
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => t, ttlMs: 30_000 });
    expect(gh.calls()).toBe(2);
  });
});
