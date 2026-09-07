// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MAX_TOOLBAR_PINS, toolbarPinKey, sanitizeToolbarPins, resolveToolbarPins, nextToolbarPins } from "../../common/toolbarPins";
import type { Shortcut } from "../../common/shortcuts";

const pin = (slug: string, kind: Shortcut["kind"] = "collection"): Shortcut => ({ kind, slug, title: slug, icon: "task" });

describe("sanitizeToolbarPins", () => {
  it("keeps well-formed keys in the order they were written", () => {
    expect(sanitizeToolbarPins(["collection:works", "feed:news"])).toEqual(["collection:works", "feed:news"]);
  });

  // The feature is opt-in: a config that never named one leaves the toolbar exactly as it was.
  it("answers empty for anything that is not an array", () => {
    for (const bad of [undefined, null, "collection:works", 3, {}]) expect(sanitizeToolbarPins(bad)).toEqual([]);
  });

  // A hand-written config, or one from a build that knew a third kind. Dropping the entry is what
  // keeps the toolbar from drawing a button with nothing to label it.
  it("drops entries that name no reachable pin", () => {
    expect(sanitizeToolbarPins(["wiki:page", "collection:", ":works", "works", "", 7, null, { kind: "collection", slug: "works" }])).toEqual([]);
  });

  it("keeps the first of a repeated key", () => {
    expect(sanitizeToolbarPins(["collection:works", "collection:works"])).toEqual(["collection:works"]);
  });

  // A collection and a feed can share a slug; they are different pins and both may be promoted.
  it("treats the two kinds as different pins", () => {
    expect(sanitizeToolbarPins(["collection:news", "feed:news"])).toEqual(["collection:news", "feed:news"]);
  });

  it("truncates past the cap rather than letting the row grow without limit", () => {
    const many = Array.from({ length: MAX_TOOLBAR_PINS + 3 }, (_, i) => `collection:c${i}`);
    expect(sanitizeToolbarPins(many)).toEqual(many.slice(0, MAX_TOOLBAR_PINS));
  });

  // The kind is one of two known words, so everything after the FIRST colon is the slug.
  it("keeps a colon inside the slug", () => {
    expect(sanitizeToolbarPins(["collection:a:b"])).toEqual(["collection:a:b"]);
  });
});

describe("resolveToolbarPins", () => {
  it("draws them in the config's order, not the pinned list's", () => {
    const shortcuts = [pin("a"), pin("b"), pin("c")];
    expect(resolveToolbarPins(shortcuts, ["collection:c", "collection:a"]).map((s) => s.slug)).toEqual(["c", "a"]);
  });

  // The label and the icon live on the pin, so a key whose pin is gone — unpinned here, or in
  // MulmoClaude, which writes the same file — has nothing to draw.
  it("drops a key whose pin no longer exists", () => {
    expect(resolveToolbarPins([pin("a")], ["collection:a", "collection:gone"]).map((s) => s.slug)).toEqual(["a"]);
  });

  it("distinguishes a feed from a collection of the same slug", () => {
    const shortcuts = [pin("news", "collection"), pin("news", "feed")];
    expect(resolveToolbarPins(shortcuts, ["feed:news"])).toEqual([pin("news", "feed")]);
  });

  it("draws nothing when none is promoted", () => {
    expect(resolveToolbarPins([pin("a")], [])).toEqual([]);
  });

  // Renaming a collection updates the PIN (reconcile refreshes title/icon), and the toolbar has to
  // follow it rather than carry a copy of the old name.
  it("takes the title and icon from the pin", () => {
    const renamed: Shortcut = { kind: "collection", slug: "a", title: "Work log", icon: "history_edu" };
    expect(resolveToolbarPins([renamed], ["collection:a"])).toEqual([renamed]);
  });
});

describe("nextToolbarPins", () => {
  const live = ["collection:a", "collection:b", "collection:c"];

  it("appends a newly promoted pin, leaving the existing order alone", () => {
    expect(nextToolbarPins(["collection:b", "collection:a"], live, "collection:c", true)).toEqual(["collection:b", "collection:a", "collection:c"]);
  });

  it("removes a demoted one", () => {
    expect(nextToolbarPins(["collection:a", "collection:b"], live, "collection:a", false)).toEqual(["collection:b"]);
  });

  // Same reference means "nothing to save" — the caller skips the write and puts the checkbox back.
  it("returns the same list when nothing would change", () => {
    const keys = ["collection:a"];
    expect(nextToolbarPins(keys, live, "collection:a", true)).toBe(keys);
    expect(nextToolbarPins(keys, live, "collection:b", false)).toBe(keys);
  });

  it("refuses to promote past the cap", () => {
    const full = Array.from({ length: MAX_TOOLBAR_PINS }, (_, i) => `collection:c${i}`);
    expect(nextToolbarPins(full, full, "collection:extra", true)).toBe(full);
  });

  it("still demotes when the list is full", () => {
    const full = Array.from({ length: MAX_TOOLBAR_PINS }, (_, i) => `collection:c${i}`);
    expect(nextToolbarPins(full, full, "collection:c0", false)).toEqual(full.slice(1));
  });

  // Codex on #1991: a promoted key whose pin was removed — here or in MulmoClaude, which writes the
  // same file — is invisible in Settings, so five of them would fill the cap with nothing to untick.
  it("drops a promoted key whose pin no longer exists", () => {
    expect(nextToolbarPins(["collection:gone", "collection:a"], live, "collection:b", true)).toEqual(["collection:a", "collection:b"]);
  });

  it("frees the slot a vanished pin was holding, so a full list can still take one", () => {
    const stale = Array.from({ length: MAX_TOOLBAR_PINS }, (_, i) => `collection:gone${i}`);
    expect(nextToolbarPins(stale, live, "collection:a", true)).toEqual(["collection:a"]);
  });

  it("prunes on a demotion too, and reports the prune as a change worth saving", () => {
    const keys = ["collection:gone", "collection:a"];
    expect(nextToolbarPins(keys, live, "collection:a", false)).toEqual([]);
    // ...and a demotion of something not held still saves, because the prune itself is the change.
    expect(nextToolbarPins(keys, live, "collection:b", false)).toEqual(["collection:a"]);
  });

  // "No favourites exist" and "the favourites have not loaded" look identical from here, and
  // writing the second back would delete the user's promotions — the rule reconcileShortcuts states
  // for the shared file.
  it("prunes nothing when the live list is empty", () => {
    const keys = ["collection:a", "collection:gone"];
    expect(nextToolbarPins(keys, [], "collection:a", false)).toEqual(["collection:gone"]);
    expect(nextToolbarPins(keys, [], "collection:b", false)).toBe(keys);
  });
});

describe("toolbarPinKey", () => {
  it("names a pin the way the config does", () => {
    expect(toolbarPinKey(pin("works"))).toBe("collection:works");
    expect(toolbarPinKey(pin("news", "feed"))).toBe("feed:news");
  });
});
