import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePrUrl, prUrlForBranch, clearPrUrlCache } from "./pr-for-branch.js";

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
});
