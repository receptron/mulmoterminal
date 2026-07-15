import { describe, it, expect } from "vitest";
import { createFileCache } from "./file-cache.js";

const stamp = (mtimeMs: number, size: number) => ({ mtimeMs, size });

describe("createFileCache", () => {
  it("returns undefined on a cold key", () => {
    const c = createFileCache<number>();
    expect(c.get("a", stamp(1, 10))).toBeUndefined();
  });

  it("returns the cached value while (mtime, size) is unchanged", () => {
    const c = createFileCache<string>();
    c.set("a", stamp(1, 10), "v1");
    expect(c.get("a", stamp(1, 10))).toBe("v1");
  });

  it("misses when mtime changes", () => {
    const c = createFileCache<string>();
    c.set("a", stamp(1, 10), "v1");
    expect(c.get("a", stamp(2, 10))).toBeUndefined();
  });

  it("misses when size changes at the same mtime (sub-tick rewrite)", () => {
    const c = createFileCache<string>();
    c.set("a", stamp(1, 10), "v1");
    expect(c.get("a", stamp(1, 11))).toBeUndefined();
  });

  it("overwrites a key's value+stamp on re-set", () => {
    const c = createFileCache<string>();
    c.set("a", stamp(1, 10), "v1");
    c.set("a", stamp(2, 20), "v2");
    expect(c.get("a", stamp(2, 20))).toBe("v2");
    expect(c.get("a", stamp(1, 10))).toBeUndefined();
  });

  it("evicts the least-recently-used key past the cap", () => {
    const c = createFileCache<string>(2);
    c.set("a", stamp(1, 1), "va");
    c.set("b", stamp(1, 1), "vb");
    c.get("a", stamp(1, 1)); // touch a → b is now LRU
    c.set("c", stamp(1, 1), "vc"); // over cap → evict b
    expect(c.get("a", stamp(1, 1))).toBe("va");
    expect(c.get("c", stamp(1, 1))).toBe("vc");
    expect(c.get("b", stamp(1, 1))).toBeUndefined();
  });
});
