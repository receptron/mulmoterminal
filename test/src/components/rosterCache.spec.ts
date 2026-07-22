import { describe, it, expect } from "vitest";

import { staleCacheKeys, rosterCellsKey } from "../../../src/components/rosterCache";

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

// Codex on #640: the cleanup watch keyed on session ids alone, so a cell that kept its
// session and only moved directory never fired it — and phaseByCwd is keyed by directory.
describe("rosterCellsKey", () => {
  const cell = (session: string | null, cwd: string | null) => ({ session, cwd });

  it("changes when a cell's session changes", () => {
    expect(rosterCellsKey([cell("a", "/w")])).not.toBe(rosterCellsKey([cell("b", "/w")]));
  });

  it("changes when only a cell's cwd changes", () => {
    expect(rosterCellsKey([cell("a", "/w")])).not.toBe(rosterCellsKey([cell("a", "/other")]));
  });

  it("does not change when nothing changed", () => {
    expect(rosterCellsKey([cell("a", "/w"), cell("b", null)])).toBe(rosterCellsKey([cell("a", "/w"), cell("b", null)]));
  });

  it("changes when a cell is added or removed", () => {
    expect(rosterCellsKey([cell("a", "/w")])).not.toBe(rosterCellsKey([cell("a", "/w"), cell("b", "/w")]));
  });

  it("changes when cells are reordered", () => {
    expect(rosterCellsKey([cell("a", "/w"), cell("b", "/x")])).not.toBe(rosterCellsKey([cell("b", "/x"), cell("a", "/w")]));
  });

  it("treats an empty roster as its own key", () => {
    expect(rosterCellsKey([])).toBe("");
  });

  // A path is user data. With a separator that can appear in one, two different rosters
  // could serialise the same and the cleanup would not fire.
  it("cannot be forged by a cwd containing the separator", () => {
    expect(rosterCellsKey([cell("a", "/w,b"), cell(null, null)])).not.toBe(rosterCellsKey([cell("a", "/w"), cell("b", null)]));
  });

  it("distinguishes an empty session from an empty cwd", () => {
    expect(rosterCellsKey([cell(null, "x")])).not.toBe(rosterCellsKey([cell("x", null)]));
  });
});
