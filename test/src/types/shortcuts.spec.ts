import { describe, it, expect } from "vitest";

import { sameShortcut } from "../../../src/types/shortcuts";

// The dedupe/removal key for the whole favourites store: unpin, the add-if-absent check, and
// the reconcile all match on this. Too loose and unpinning one favourite removes another;
// too tight and the same thing can be pinned twice.
describe("sameShortcut", () => {
  it("matches the same kind and slug", () => {
    expect(sameShortcut({ kind: "collection", slug: "tasks" }, { kind: "collection", slug: "tasks" })).toBe(true);
  });

  // A collection and a feed may legitimately share a slug — they are different targets, and
  // matching on slug alone would let one unpin the other.
  it("does not match the same slug under a different kind", () => {
    expect(sameShortcut({ kind: "collection", slug: "news" }, { kind: "feed", slug: "news" })).toBe(false);
  });

  it("does not match different slugs of the same kind", () => {
    expect(sameShortcut({ kind: "feed", slug: "a" }, { kind: "feed", slug: "b" })).toBe(false);
  });

  it("is exact, not fuzzy", () => {
    expect(sameShortcut({ kind: "collection", slug: "tasks" }, { kind: "collection", slug: "Tasks" })).toBe(false);
    expect(sameShortcut({ kind: "collection", slug: "tasks" }, { kind: "collection", slug: "tasks " })).toBe(false);
  });

  it("ignores the fields that are not part of the identity", () => {
    const left = { kind: "collection", slug: "tasks", title: "One", icon: "star" } as const;
    const right = { kind: "collection", slug: "tasks", title: "Two", icon: "bolt" } as const;
    expect(sameShortcut(left, right)).toBe(true);
  });
});
