import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePrUrl, prUrlForBranch, clearPrUrlCache } from "../../../server/git/pr-for-branch.js";

const ok = (stdout: string) => vi.fn(async () => ({ ok: true, stdout, stderr: "", code: 0 }));

describe("parsePrUrl", () => {
  it("returns the first PR's url", () => {
    expect(parsePrUrl('[{"url":"https://github.com/o/r/pull/3"}]')).toBe("https://github.com/o/r/pull/3");
  });
  it("returns null for an empty list, malformed JSON, or a missing url", () => {
    expect(parsePrUrl("[]")).toBeNull();
    expect(parsePrUrl("not json")).toBeNull();
    expect(parsePrUrl('[{"number":3}]')).toBeNull();
  });
});

describe("prUrlForBranch", () => {
  beforeEach(() => clearPrUrlCache());

  it("returns the open PR's url via gh pr list --head", async () => {
    const runGh = ok('[{"url":"https://github.com/o/r/pull/7"}]');
    const url = await prUrlForBranch("o/r", "feat/x", { runGh, now: () => 0 });
    expect(url).toBe("https://github.com/o/r/pull/7");
    expect(runGh).toHaveBeenCalledWith(["pr", "list", "--head", "feat/x", "--repo", "o/r", "--state", "open", "--json", "url", "--limit", "1"]);
  });

  it("returns null when there is no open PR", async () => {
    expect(await prUrlForBranch("o/r", "feat/x", { runGh: ok("[]"), now: () => 0 })).toBeNull();
  });

  it("returns null (never throws) when gh fails or errors", async () => {
    expect(await prUrlForBranch("o/r", "b", { runGh: vi.fn(async () => ({ ok: false, stdout: "", stderr: "boom", code: 1 })), now: () => 0 })).toBeNull();
    const thrower = vi.fn(async () => {
      throw new Error("spawn failed");
    });
    expect(await prUrlForBranch("o/r", "b2", { runGh: thrower, now: () => 0 })).toBeNull();
  });

  it("caches within the TTL and re-queries after it expires", async () => {
    const runGh = ok('[{"url":"https://github.com/o/r/pull/1"}]');
    let t = 1000;
    const now = () => t;
    await prUrlForBranch("o/r", "b", { runGh, now, ttlMs: 100 });
    await prUrlForBranch("o/r", "b", { runGh, now, ttlMs: 100 }); // within TTL → cache hit
    expect(runGh).toHaveBeenCalledTimes(1);
    t += 200; // past TTL
    await prUrlForBranch("o/r", "b", { runGh, now, ttlMs: 100 });
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  // Regression (#748): a gh failure was cached as "no PR" for the full TTL, hiding the PR
  // button even after gh recovered. A failed lookup must NOT be cached — the next call retries.
  it("does not cache a gh failure — a later success within the TTL is picked up", async () => {
    const runGh = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, stdout: "", stderr: "rate limited", code: 1 })
      .mockResolvedValueOnce({ ok: true, stdout: '[{"url":"https://github.com/o/r/pull/9"}]', stderr: "", code: 0 });
    const now = () => 5000; // same instant both calls: a cached failure would survive
    expect(await prUrlForBranch("o/r", "b", { runGh, now, ttlMs: 100000 })).toBeNull();
    expect(await prUrlForBranch("o/r", "b", { runGh, now, ttlMs: 100000 })).toBe("https://github.com/o/r/pull/9");
    expect(runGh).toHaveBeenCalledTimes(2); // second call actually re-queried (no cached failure)
  });
});
