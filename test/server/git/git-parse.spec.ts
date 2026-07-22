// @vitest-environment node
import { describe, it, expect } from "vitest";

import { capPatch, lastGhUrl, parseNumstatLine } from "../../../server/git/git-parse.js";

const toCount = (s: string) => Number(s) || 0;

describe("lastGhUrl", () => {
  it("takes the last http line", () => {
    expect(lastGhUrl("Warning: something\nhttps://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
  });

  // gh prints the PR URL last — an earlier http line (a tip, an Actions URL) must not win.
  // Both lines here start with http, so this genuinely tests LAST, not just "the only one".
  it("prefers the last URL when several http lines are present", () => {
    expect(lastGhUrl("https://github.com/o/r/actions/runs/9\nhttps://github.com/o/r/pull/2\n")).toBe("https://github.com/o/r/pull/2");
  });

  it("trims surrounding whitespace", () => {
    expect(lastGhUrl("   https://github.com/o/r/pull/3   ")).toBe("https://github.com/o/r/pull/3");
  });

  it("is null when there is no http line", () => {
    expect(lastGhUrl("Creating pull request...\ndone")).toBeNull();
    expect(lastGhUrl("")).toBeNull();
  });
});

describe("parseNumstatLine", () => {
  it("parses adds, dels and path", () => {
    expect(parseNumstatLine("3\t1\tsrc/a.ts", toCount)).toEqual({ path: "src/a.ts", additions: 3, deletions: 1 });
  });

  // A binary file reports "-" — the badge must show "binary", not a bogus count.
  it("maps a binary '-' count to -1", () => {
    expect(parseNumstatLine("-\t-\timage.png", toCount)).toEqual({ path: "image.png", additions: -1, deletions: -1 });
  });

  // A path containing a tab must survive — split then rejoin with tabs.
  it("keeps a tab inside the path", () => {
    expect(parseNumstatLine("1\t0\tweird\tname.ts", toCount).path).toBe("weird\tname.ts");
  });

  it("handles one side binary and the other numeric", () => {
    expect(parseNumstatLine("5\t-\tmixed", toCount)).toEqual({ path: "mixed", additions: 5, deletions: -1 });
  });
});

describe("capPatch", () => {
  it("passes a short patch through untouched", () => {
    expect(capPatch("diff", 100)).toEqual({ patch: "diff", truncated: false });
  });

  it("truncates and flags a patch over the limit", () => {
    expect(capPatch("abcdef", 4)).toEqual({ patch: "abcd", truncated: true });
  });

  // Exactly at the limit is not truncated (> not >=).
  it("does not truncate a patch exactly at the limit", () => {
    expect(capPatch("abcd", 4)).toEqual({ patch: "abcd", truncated: false });
  });
});
