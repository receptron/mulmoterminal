import { describe, it, expect } from "vitest";

import { reconcileShortcuts } from "../../../src/composables/reconcileShortcuts";
import type { Shortcut } from "../../../src/types/shortcuts";

const pin = (kind: Shortcut["kind"], slug: string, title = slug, icon = "star"): Shortcut => ({ kind, slug, title, icon });

describe("reconcileShortcuts", () => {
  // The flag the caller writes on. A routine index fetch that changed nothing must not
  // rewrite a file shared with another app.
  it("reports no drift when everything already matches", () => {
    const current = [pin("collection", "tasks"), pin("feed", "news")];
    const result = reconcileShortcuts(current, "collection", [{ slug: "tasks", title: "tasks", icon: "star" }]);
    expect(result.drifted).toBe(false);
    expect(result.next).toEqual(current);
  });

  it("drops a shortcut whose target no longer exists", () => {
    const result = reconcileShortcuts([pin("collection", "gone"), pin("collection", "tasks")], "collection", [{ slug: "tasks", title: "tasks", icon: "star" }]);
    expect(result.drifted).toBe(true);
    expect(result.next.map((s) => s.slug)).toEqual(["tasks"]);
  });

  it("refreshes a renamed title and a changed icon", () => {
    const result = reconcileShortcuts([pin("collection", "tasks", "Old", "star")], "collection", [{ slug: "tasks", title: "New", icon: "bolt" }]);
    expect(result.drifted).toBe(true);
    expect(result.next).toEqual([{ kind: "collection", slug: "tasks", title: "New", icon: "bolt" }]);
  });

  // The persist is REPLACE-ALL against a file shared with MulmoClaude, so a fetch about one
  // kind must never take the other kind's pins with it. This is the deletion that has no undo.
  it("never touches another kind, even when that kind's slugs are absent from the live list", () => {
    const current = [pin("feed", "news"), pin("feed", "blog"), pin("collection", "tasks")];
    const result = reconcileShortcuts(current, "collection", [{ slug: "tasks", title: "tasks", icon: "star" }]);
    expect(result.next.filter((s) => s.kind === "feed")).toHaveLength(2);
  });

  // A failed/empty fetch reaching this would wipe every pin of that kind. Pinned as the
  // documented consequence, so a future caller knows an empty list must never be passed
  // speculatively.
  it("prunes everything of that kind when the live list is empty", () => {
    const result = reconcileShortcuts([pin("collection", "a"), pin("feed", "b")], "collection", []);
    expect(result.drifted).toBe(true);
    expect(result.next.map((s) => s.slug)).toEqual(["b"]);
  });

  it("keeps the user's order rather than the live list's", () => {
    const current = [pin("collection", "c"), pin("collection", "a"), pin("collection", "b")];
    const live = [
      { slug: "a", title: "a", icon: "star" },
      { slug: "b", title: "b", icon: "star" },
      { slug: "c", title: "c", icon: "star" },
    ];
    expect(reconcileShortcuts(current, "collection", live).next.map((s) => s.slug)).toEqual(["c", "a", "b"]);
  });

  it("does not add a live entry the user never pinned", () => {
    const result = reconcileShortcuts([pin("collection", "tasks")], "collection", [
      { slug: "tasks", title: "tasks", icon: "star" },
      { slug: "unpinned", title: "unpinned", icon: "star" },
    ]);
    expect(result.next.map((s) => s.slug)).toEqual(["tasks"]);
  });

  it("does not mutate the list it was given", () => {
    const current = [pin("collection", "tasks", "Old")];
    reconcileShortcuts(current, "collection", [{ slug: "tasks", title: "New", icon: "bolt" }]);
    expect(current[0].title).toBe("Old");
  });

  it("handles an empty store without drift", () => {
    expect(reconcileShortcuts([], "collection", [{ slug: "tasks", title: "tasks", icon: "star" }])).toEqual({ next: [], drifted: false });
  });

  // Same slug under both kinds is legal — they are different targets.
  it("matches on kind and slug together", () => {
    const current = [pin("collection", "news", "Collection news"), pin("feed", "news", "Feed news")];
    const result = reconcileShortcuts(current, "feed", [{ slug: "news", title: "Feed news renamed", icon: "star" }]);
    expect(result.next).toEqual([pin("collection", "news", "Collection news"), { kind: "feed", slug: "news", title: "Feed news renamed", icon: "star" }]);
  });
});
