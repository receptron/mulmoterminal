// @vitest-environment node
// The rule behind adopting a reattached codex's rollout (#3283): exactly one rollout of this
// session's root open in its process tree, not claimed by another cell — or nothing.
import { describe, it, expect } from "vitest";
import { pickOpenRollout, type RolloutRoot } from "../../../../server/agents/codex/codex-open-rollout.js";

// lsof prints the resolved path; the server spells the root the way it was configured.
const ROOT: RolloutRoot = { listed: "/tmp/home/.codex/sessions", canonical: "/private/tmp/home/.codex/sessions" };
const NAME = "rollout-2026-11-05T22-40-08-01a1ad94-4239-70c3-aff1-e7bf4f66d5b5.jsonl";
const OPEN = `${ROOT.canonical}/2026/11/05/${NAME}`;
const LISTED = `${ROOT.listed}/2026/11/05/${NAME}`;
const OTHER = `${ROOT.canonical}/2026/11/04/rollout-2026-11-04T09-00-00-01a1ad99-a59e-7221-91c0-a4af27fca3e8.jsonl`;
const NONE = new Set<string>();

describe("pickOpenRollout", () => {
  it("returns the one open rollout, spelled under the listed root", () => {
    expect(pickOpenRollout([OPEN], ROOT, NONE)).toBe(LISTED);
  });

  it("ignores everything that is not a rollout of this root", () => {
    const noise = [
      "/dev/ttys004",
      `${ROOT.canonical}/../state_5.sqlite`,
      `${ROOT.canonical}/2026/11/05/history.jsonl`,
      `/private/tmp/other/.codex/sessions/2026/11/05/${NAME}`,
      ROOT.canonical,
      "",
    ];
    expect(pickOpenRollout([...noise, OPEN], ROOT, NONE)).toBe(LISTED);
    expect(pickOpenRollout(noise, ROOT, NONE)).toBeNull();
  });

  it("counts one file held by several descriptors or processes once", () => {
    expect(pickOpenRollout([OPEN, OPEN, OPEN], ROOT, NONE)).toBe(LISTED);
  });

  it("refuses two distinct rollouts rather than choosing", () => {
    expect(pickOpenRollout([OPEN, OTHER], ROOT, NONE)).toBeNull();
  });

  it("refuses the one rollout when another cell already claimed it", () => {
    expect(pickOpenRollout([OPEN], ROOT, new Set([LISTED]))).toBeNull();
  });

  // A claim on one of two does not make the other unambiguous: the tree still holds two.
  it("stays ambiguous when one of two is claimed", () => {
    expect(pickOpenRollout([OPEN, OTHER], ROOT, new Set([LISTED]))).toBeNull();
  });

  it("returns nothing for no open files", () => {
    expect(pickOpenRollout([], ROOT, NONE)).toBeNull();
  });

  it("accepts a root that needs no resolving", () => {
    const plain: RolloutRoot = { listed: ROOT.canonical, canonical: ROOT.canonical };
    expect(pickOpenRollout([OPEN], plain, NONE)).toBe(OPEN);
  });

  it("does not take a sibling directory that merely shares the root's prefix", () => {
    expect(pickOpenRollout([`${ROOT.canonical}-old/2026/11/05/${NAME}`], ROOT, NONE)).toBeNull();
  });
});
