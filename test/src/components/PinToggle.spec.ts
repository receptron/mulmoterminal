// What a pin made in THIS app carries into the shared file (#1995).
//
// The file is `<workspace>/config/shortcuts.json`, which MulmoClaude reads and draws. A field this
// component does not pass is simply not stored, and the gap is visible only in the other app — a
// pin made here sat colourless in MulmoClaude's launcher until an index visit reconciled a colour
// in. The plugin has been passing the colour all along; these props were what dropped it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import PinToggle from "../../../src/components/PinToggle.vue";
import type { Shortcut } from "../../../common/shortcuts";

const pinned = vi.hoisted((): { calls: Shortcut[]; unpins: string[]; has: boolean } => ({ calls: [], unpins: [], has: false }));
vi.mock("../../../src/composables/useShortcuts", () => ({
  useShortcuts: () => ({
    isPinned: () => pinned.has,
    pin: (shortcut: Shortcut) => {
      pinned.calls.push(shortcut);
      return Promise.resolve(true);
    },
    unpin: (kind: string, slug: string) => {
      pinned.unpins.push(`${kind}:${slug}`);
      return Promise.resolve(true);
    },
  }),
}));

const base = { kind: "collection", slug: "lens", title: "カメラのレンズ", icon: "photo_camera" } as const;

describe("PinToggle", () => {
  beforeEach(() => {
    pinned.calls = [];
    pinned.unpins = [];
    pinned.has = false;
  });

  it("caches the colour the plugin hands it", async () => {
    const wrapper = mount(PinToggle, { props: { ...base, color: "amber" } });
    await wrapper.get("button").trigger("click");
    expect(pinned.calls).toEqual([{ ...base, color: "amber" }]);
  });

  // Absent rather than null: the key would otherwise ride into a file the other app reads, and
  // `color: undefined` serialises as `null` there.
  it("leaves the key out when the collection names no colour", async () => {
    const wrapper = mount(PinToggle, { props: base });
    await wrapper.get("button").trigger("click");
    expect(pinned.calls).toEqual([base]);
    expect("color" in pinned.calls[0]).toBe(false);
  });

  it("unpins by identity, which carries no colour either way", async () => {
    pinned.has = true;
    const wrapper = mount(PinToggle, { props: { ...base, color: "amber" } });
    await wrapper.get("button").trigger("click");
    expect(pinned.calls).toEqual([]);
    expect(pinned.unpins).toEqual(["collection:lens"]);
  });
});
