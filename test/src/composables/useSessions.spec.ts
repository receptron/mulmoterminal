import { describe, it, expect } from "vitest";
import { mergeStable, isUnread, type Session } from "../../../src/composables/useSessions";

function row(id: string): Session {
  return { id, title: id, mtime: 1, working: false, waiting: false };
}

describe("isUnread", () => {
  it("is true for a waiting, non-hidden session", () => {
    expect(isUnread({ ...row("a"), waiting: true })).toBe(true);
  });

  it("is false when not waiting", () => {
    expect(isUnread(row("a"))).toBe(false);
  });

  it("is false for a hidden background worker even when waiting (the bug fix)", () => {
    expect(isUnread({ ...row("a"), waiting: true, hidden: true })).toBe(false);
  });
});

describe("mergeStable", () => {
  it("takes the server order on the first load (empty prev)", () => {
    const incoming = [row("a"), row("b")];
    expect(mergeStable([], incoming, false).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("keeps existing rows in place even when the server reorders them", () => {
    // The server sorts by recency; switching sessions bumps mtimes and would
    // otherwise reshuffle the list under the user.
    const prev = [row("a"), row("b")];
    const incoming = [row("b"), row("a")]; // b is now newest
    expect(mergeStable(prev, incoming, false).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("prepends genuinely-new sessions (newest-first) and drops vanished ones", () => {
    const prev = [row("a"), row("b")];
    const incoming = [row("c"), row("a")]; // b gone, c new; (no b)
    expect(mergeStable(prev, incoming, false).map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("refreshes the data of kept rows in place", () => {
    const prev = [{ ...row("a"), working: false }];
    const incoming = [{ ...row("a"), working: true }];
    const merged = mergeStable(prev, incoming, false);
    expect(merged[0].working).toBe(true);
  });

  it("re-sorts to the server order when resort is requested", () => {
    const prev = [row("a"), row("b")];
    const incoming = [row("b"), row("a")];
    expect(mergeStable(prev, incoming, true).map((s) => s.id)).toEqual(["b", "a"]);
  });
});
