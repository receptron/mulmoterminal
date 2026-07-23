// @vitest-environment node
import { describe, it, expect } from "vitest";

import { createTtlCache } from "../../../server/git/ttl-cache.js";

// A fixed clock, so every expiry test is deterministic — the whole point of the injected `now`.
const at = (ms: number) => (): number => ms;

describe("createTtlCache", () => {
  it("returns undefined for a key that was never set", () => {
    const cache = createTtlCache<string>();
    expect(cache.get("missing", at(0), 100)).toBeUndefined();
  });

  // The freshness window is [0, ttlMs): a value survives while its age is strictly less than
  // ttlMs, and an age of EXACTLY ttlMs is already stale. Widening the `<` to `<=` would serve an
  // entry one tick too long — invisible until stale data leaks out. A ttlMs of 0 is never fresh,
  // since `now() - at < 0` can't hold even for an immediate read.
  it.each<[number, number, string | undefined]>([
    [50, 100, "v"], // comfortably inside
    [99, 100, "v"], // last fresh tick
    [100, 100, undefined], // exactly ttlMs — stale
    [101, 100, undefined], // past expiry
    [0, 0, undefined], // ttl 0 — never fresh
  ])("an age of %d against ttl %d yields %j", (readAt, ttlMs, expected) => {
    const cache = createTtlCache<string>();
    cache.set("k", "v", at(0));
    expect(cache.get("k", at(readAt), ttlMs)).toBe(expected);
  });

  // The invariant the comment pins: get reads the clock ONLY on a hit, so probing a missing key
  // must not even call `now`. Proven by a clock that throws if read.
  it("does not read the clock when the key is absent", () => {
    const cache = createTtlCache<string>();
    const throwingNow = (): number => {
      throw new Error("clock must not be read on a miss");
    };
    expect(() => cache.get("missing", throwingNow, 100)).not.toThrow();
    expect(cache.get("missing", throwingNow, 100)).toBeUndefined();
  });

  it("reads the clock on a hit", () => {
    const cache = createTtlCache<string>();
    let reads = 0;
    const countingNow = (): number => {
      reads += 1;
      return 10;
    };
    cache.set("k", "v", at(0));
    cache.get("k", countingNow, 100);
    expect(reads).toBe(1);
  });

  it("re-stamps the write time when a key is overwritten", () => {
    const cache = createTtlCache<string>();
    cache.set("k", "old", at(0));
    cache.set("k", "new", at(200));
    // 250 - 200 = 50 < 100 → fresh, and the value is the newer one.
    expect(cache.get("k", at(250), 100)).toBe("new");
  });

  it("expires each key against its own write time", () => {
    const cache = createTtlCache<string>();
    cache.set("a", "va", at(0));
    cache.set("b", "vb", at(100));
    expect(cache.get("a", at(150), 100)).toBeUndefined(); // 150 - 0  = 150 ≥ 100
    expect(cache.get("b", at(150), 100)).toBe("vb"); //        150 - 100 = 50  < 100
  });

  it("drops everything on clear", () => {
    const cache = createTtlCache<string>();
    cache.set("k", "v", at(0));
    cache.clear();
    expect(cache.get("k", at(0), 100)).toBeUndefined();
  });

  it("keeps each instance's store separate", () => {
    const one = createTtlCache<string>();
    const two = createTtlCache<string>();
    one.set("k", "v", at(0));
    expect(two.get("k", at(0), 100)).toBeUndefined();
  });

  it("returns the stored reference for object values", () => {
    const cache = createTtlCache<{ n: number }>();
    const value = { n: 1 };
    cache.set("k", value, at(0));
    expect(cache.get("k", at(0), 100)).toBe(value);
  });
});
