import { describe, it, expect } from "vitest";

import { staleCacheKeys } from "../../../src/components/rosterCache";

const inUse = (...keys: string[]) => new Set(keys);

describe("staleCacheKeys", () => {
  it("drops a key no cell asks for any more", () => {
    expect(staleCacheKeys(["closed", "open"], inUse("open"))).toEqual(["closed"]);
  });

  it("keeps everything still in use", () => {
    expect(staleCacheKeys(["a", "b"], inUse("a", "b"))).toEqual([]);
  });

  it("drops everything when no cell is left", () => {
    expect(staleCacheKeys(["a", "b"], inUse())).toEqual(["a", "b"]);
  });

  it("has nothing to drop from an empty cache", () => {
    expect(staleCacheKeys([], inUse("a"))).toEqual([]);
  });

  // A key that is in use but not cached is simply not our business — the poll fills it.
  it("says nothing about a key that is in use but uncached", () => {
    expect(staleCacheKeys(["a"], inUse("a", "b"))).toEqual([]);
  });

  it("accepts the Map key iterator the caches hand it", () => {
    const cache = new Map([
      ["a", 1],
      ["gone", 2],
    ]);
    expect(staleCacheKeys(cache.keys(), inUse("a"))).toEqual(["gone"]);
  });

  // Relaunching a cell gives it a new session id; the old one is what has to go.
  it("drops the id a relaunched cell replaced", () => {
    expect(staleCacheKeys(["old-session", "other"], inUse("new-session", "other"))).toEqual(["old-session"]);
  });
});
