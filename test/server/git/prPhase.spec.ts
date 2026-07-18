// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";

import { derivePrPhase, parsePrList, phaseForRepoBranch, clearPrPhaseCache, type ParsedPr } from "../../../server/git/prPhase.js";

const pr = (over: Partial<ParsedPr> = {}): ParsedPr => ({ state: "OPEN", isDraft: false, reviewDecision: "", ci: "passing", url: null, ...over });

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

describe("parsePrList", () => {
  it("parses each PR and rolls up its CI", () => {
    const stdout = JSON.stringify([{ state: "OPEN", isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [{ conclusion: "SUCCESS" }], url: "u1" }]);
    expect(parsePrList(stdout)).toEqual([{ state: "OPEN", isDraft: false, reviewDecision: "APPROVED", ci: "passing", url: "u1" }]);
  });

  it("rolls a mixed check set with a failure to failing", () => {
    const stdout = JSON.stringify([{ state: "OPEN", statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] }]);
    expect(parsePrList(stdout)[0]?.ci).toBe("failing");
  });

  it("returns none-CI for an empty rollup", () => {
    expect(parsePrList(JSON.stringify([{ state: "OPEN", statusCheckRollup: [] }]))[0]?.ci).toBe("none");
  });

  it.each([
    ["an empty array", "[]"],
    ["malformed JSON", "{ not json"],
    ["a non-array", '{"state":"OPEN"}'],
  ])("returns an empty list for %s", (_label, stdout) => {
    expect(parsePrList(stdout)).toEqual([]);
  });

  it("defaults missing fields", () => {
    expect(parsePrList(JSON.stringify([{}]))).toEqual([{ state: "", isDraft: false, reviewDecision: "", ci: "none", url: null }]);
  });
});

describe("phaseForRepoBranch", () => {
  beforeEach(() => clearPrPhaseCache());

  // gh stub keyed by the `--state` in the args (open-first, then all).
  const ghByState = (byState: { open?: string; all?: string }, ok = true) => {
    let calls = 0;
    const states: string[] = [];
    const fn = async (args: string[]) => {
      calls += 1;
      const state = args[args.indexOf("--state") + 1];
      states.push(state);
      return { ok, stdout: (state === "open" ? byState.open : byState.all) ?? "[]", stderr: "" };
    };
    return { fn, calls: () => calls, states: () => states };
  };

  const openPr = JSON.stringify([{ state: "OPEN", isDraft: false, statusCheckRollup: [{ conclusion: "SUCCESS" }], url: "https://github.com/o/r/pull/2" }]);

  it("derives phase and url from the open PR (one query, no fallback)", async () => {
    const gh = ghByState({ open: openPr });
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn });
    expect(result).toEqual({ phase: "ready", url: "https://github.com/o/r/pull/2" });
    expect(gh.states()).toEqual(["open"]); // never fell through to --state all
  });

  it("falls back to --state all for a merged branch (no open PR)", async () => {
    const gh = ghByState({ open: "[]", all: JSON.stringify([{ state: "MERGED", url: "u" }]) });
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn });
    expect(result).toEqual({ phase: "merged", url: "u" });
    expect(gh.states()).toEqual(["open", "all"]);
  });

  // Codex iter-1/2: an open PR must never be masked by a stale merged/closed same-head PR,
  // even with many historical PRs — querying --state open first guarantees it.
  it("returns the open PR without consulting merged history for a reused head branch", async () => {
    const gh = ghByState({ open: openPr, all: JSON.stringify([{ state: "MERGED", url: "old" }]) });
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn });
    expect(result.url).toBe("https://github.com/o/r/pull/2");
    expect(gh.states()).toEqual(["open"]);
  });

  it("resolves to none when gh fails", async () => {
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh: ghByState({}, false).fn });
    expect(result).toEqual({ phase: "none", url: null });
  });

  it("resolves to none when there is no PR at all", async () => {
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh: ghByState({ open: "[]", all: "[]" }).fn });
    expect(result).toEqual({ phase: "none", url: null });
  });

  // Codex iter-3: a FAILED open query must not fall through to --state all (which could report
  // a stale merged PR for a reused head); it resolves to none without consulting history.
  it("does not consult history when the open query fails", async () => {
    const states: string[] = [];
    const runGh = async (args: string[]) => {
      const state = args[args.indexOf("--state") + 1];
      states.push(state);
      if (state === "open") return { ok: false, stdout: "", stderr: "" };
      return { ok: true, stdout: JSON.stringify([{ state: "MERGED", url: "stale" }]), stderr: "" };
    };
    const result = await phaseForRepoBranch("o/r", "feat/x", { runGh });
    expect(result).toEqual({ phase: "none", url: null });
    expect(states).toEqual(["open"]);
  });

  it("does not cache a failed query, so the next poll retries", async () => {
    let attempt = 0;
    const runGh = async (args: string[]) => {
      const state = args[args.indexOf("--state") + 1];
      attempt += 1;
      if (state === "open" && attempt === 1) return { ok: false, stdout: "", stderr: "" };
      return { ok: true, stdout: openPr, stderr: "" };
    };
    const first = await phaseForRepoBranch("o/r", "feat/x", { runGh, now: () => 1000 });
    expect(first.phase).toBe("none");
    const second = await phaseForRepoBranch("o/r", "feat/x", { runGh, now: () => 1000 });
    expect(second.phase).toBe("ready"); // not cached → retried → real result
  });

  it("caches within the TTL (one lookup's queries serve a second lookup)", async () => {
    const gh = ghByState({ open: openPr });
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => 1000, ttlMs: 30_000 });
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => 1000, ttlMs: 30_000 });
    expect(gh.calls()).toBe(1);
  });

  it("re-queries once the TTL has elapsed", async () => {
    const gh = ghByState({ open: openPr });
    let t = 1000;
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => t, ttlMs: 30_000 });
    t = 1000 + 31_000;
    await phaseForRepoBranch("o/r", "feat/x", { runGh: gh.fn, now: () => t, ttlMs: 30_000 });
    expect(gh.calls()).toBe(2);
  });
});
