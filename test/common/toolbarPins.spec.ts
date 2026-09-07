// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MAX_TOOLBAR_PINS, MAX_STORED_TOOLBAR_PINS, toolbarPinKey, sanitizeToolbarPins, resolveToolbarPins, nextToolbarPins } from "../../common/toolbarPins";
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

  // The FILE's bound, not the number of buttons: a key past the fifth is one whose pin is unpinned
  // right now, and truncating to five would delete it.
  it("keeps more keys than the toolbar can draw, up to the file's bound", () => {
    const many = Array.from({ length: MAX_STORED_TOOLBAR_PINS + 3 }, (_, i) => `collection:c${i}`);
    expect(sanitizeToolbarPins(many)).toEqual(many.slice(0, MAX_STORED_TOOLBAR_PINS));
    expect(MAX_STORED_TOOLBAR_PINS).toBeGreaterThan(MAX_TOOLBAR_PINS);
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

  // The file may hold more keys than the row has buttons, so the cut happens here — and it happens
  // AFTER the gone ones are skipped, so a dead key never costs a live one its place.
  it("draws at most the row's worth, skipping the ones whose pins are gone", () => {
    const shortcuts = Array.from({ length: MAX_TOOLBAR_PINS + 2 }, (_, i) => pin(`live${i}`));
    const keys = ["collection:gone", ...shortcuts.map((s) => `collection:${s.slug}`)];
    expect(resolveToolbarPins(shortcuts, keys).map((s) => s.slug)).toEqual(shortcuts.slice(0, MAX_TOOLBAR_PINS).map((s) => s.slug));
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

  it("refuses to promote past the number of buttons the row can draw", () => {
    const full = Array.from({ length: MAX_TOOLBAR_PINS }, (_, i) => `collection:c${i}`);
    expect(nextToolbarPins(full, full, "collection:extra", true)).toBe(full);
  });

  it("still demotes when the row is full", () => {
    const full = Array.from({ length: MAX_TOOLBAR_PINS }, (_, i) => `collection:c${i}`);
    expect(nextToolbarPins(full, full, "collection:c0", false)).toEqual(full.slice(1));
  });

  // THE invariant of this design: a save touches the key that was clicked and nothing else. It is
  // what makes a stale `live` harmless, and it is why the four freshness findings on PR #1991
  // cannot come back as data loss.
  it("never removes a key other than the one being demoted", () => {
    const keys = ["collection:gone", "collection:a", "feed:also-gone"];
    expect(nextToolbarPins(keys, live, "collection:b", true)).toEqual([...keys, "collection:b"]);
    expect(nextToolbarPins(keys, live, "collection:a", false)).toEqual(["collection:gone", "feed:also-gone"]);
  });

  // Codex on #1991: a key whose pin is gone draws nothing, so counting it toward the five would
  // fill the row with buttons that are not there and leave nothing to untick.
  it("does not let keys whose pins are gone use up the row", () => {
    const stale = Array.from({ length: MAX_TOOLBAR_PINS }, (_, i) => `collection:gone${i}`);
    expect(nextToolbarPins(stale, live, "collection:a", true)).toEqual([...stale, "collection:a"]);
  });

  // An empty `live` is "the favourites have not loaded". Nothing is deleted on the strength of it —
  // the count is simply zero, so a promotion still goes through.
  it("promotes even when the live list is unknown", () => {
    const keys = ["collection:a"];
    expect(nextToolbarPins(keys, [], "collection:b", true)).toEqual(["collection:a", "collection:b"]);
  });

  // The file's own bound is the only thing that can refuse a promotion for a reason other than the
  // row being full — a config would need forty-five unpinned promotions to reach it.
  it("stops appending at the file's bound", () => {
    const many = Array.from({ length: MAX_STORED_TOOLBAR_PINS }, (_, i) => `collection:gone${i}`);
    expect(nextToolbarPins(many, live, "collection:a", true)).toBe(many);
  });
});

describe("toolbarPinKey", () => {
  it("names a pin the way the config does", () => {
    expect(toolbarPinKey(pin("works"))).toBe("collection:works");
    expect(toolbarPinKey(pin("news", "feed"))).toBe("feed:news");
  });
});
