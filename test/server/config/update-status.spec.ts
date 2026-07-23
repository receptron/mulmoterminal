import { describe, it, expect } from "vitest";
import { parseCacheEntry, isCacheFresh } from "../../../server/config/update-status.js";

describe("parseCacheEntry", () => {
  it("reads a cached notice with its timestamp", () => {
    expect(parseCacheEntry({ notice: "Update available: git pull", at: 1000 })).toEqual({
      notice: "Update available: git pull",
      at: 1000,
    });
  });

  it("keeps the timestamp but nulls a clean notice", () => {
    expect(parseCacheEntry({ notice: null, at: 1000 })).toEqual({ notice: null, at: 1000 });
    expect(parseCacheEntry({ notice: "", at: 1000 })).toEqual({ notice: null, at: 1000 });
  });

  // No usable timestamp => no usable cache => the check must re-run rather than trust it.
  it("is null without a numeric timestamp", () => {
    expect(parseCacheEntry({ notice: "x" })).toBeNull();
    expect(parseCacheEntry({ notice: "x", at: "soon" })).toBeNull();
  });

  // A hand-edited or half-written file must never throw the route.
  it("is null for junk", () => {
    expect(parseCacheEntry(null)).toBeNull();
    expect(parseCacheEntry("nope")).toBeNull();
    expect(parseCacheEntry(42)).toBeNull();
  });
});

describe("isCacheFresh", () => {
  const TTL = 60 * 60 * 1000;

  it("is fresh within the ttl", () => {
    expect(isCacheFresh(1000, 1000 + TTL - 1, TTL)).toBe(true);
    expect(isCacheFresh(1000, 1000, TTL)).toBe(true);
  });

  it("is stale at or past the ttl", () => {
    expect(isCacheFresh(1000, 1000 + TTL, TTL)).toBe(false);
    expect(isCacheFresh(1000, 1000 + TTL + 1, TTL)).toBe(false);
  });

  // A timestamp from the future (clock skew, a copied file) isn't trustworthy — re-check.
  it("rejects a future timestamp", () => {
    expect(isCacheFresh(2000, 1000, TTL)).toBe(false);
  });

  it("rejects a missing / non-numeric timestamp", () => {
    expect(isCacheFresh(undefined, 1000, TTL)).toBe(false);
    expect(isCacheFresh(0, 1000, TTL)).toBe(false);
    expect(isCacheFresh("1000", 1000, TTL)).toBe(false);
  });
});
