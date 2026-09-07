// The pinned-shortcuts store reads ONE file that MulmoClaude also writes, and it caches its first
// successful read for the life of the page. Settings' Toolbar pins asks for a re-read on open
// (#1984), which is the first thing in the app to run two GETs at once — and nothing about the
// network says the older one answers first.
//
// So this pins the rule that made that safe: LATEST WINS. Without it a stale answer landing second
// overwrites the fresh list, and everything reading the store — the toolbar's buttons, and the
// prune the Toolbar pins pane applies when it saves — decides from a list the disk no longer has
// (Codex, PR #1991).
import { describe, it, expect, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { Shortcut } from "../../../common/shortcuts";

const shortcut = (slug: string): Shortcut => ({ kind: "collection", slug, title: slug, icon: "task" });

interface Gate {
  promise: Promise<void>;
  open: () => void;
}
const gate = (): Gate => {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
};

// Each answer waits for its own gate, so the test decides the order they land in.
function stubFetch(bodies: { shortcuts: Shortcut[] }[], gates: Gate[]): void {
  let call = 0;
  globalThis.fetch = vi.fn(async () => {
    const index = call++;
    await gates[index].promise;
    return { ok: true, json: async () => bodies[index] };
  }) as unknown as typeof fetch;
}

describe("useShortcuts reads", () => {
  // Imported INSIDE the test on purpose: the store is module state, and the fetch stub has to be in
  // place before the module's first `load()` runs — the exception CLAUDE.md names for a module that
  // must be evaluated after its surroundings are set up.
  it("adopts the forced re-read even when the first request answers last", async () => {
    vi.resetModules();
    const gates = [gate(), gate()];
    stubFetch([{ shortcuts: [shortcut("stale")] }, { shortcuts: [shortcut("fresh")] }], gates);

    const { useShortcuts } = await import("../../../src/composables/useShortcuts");
    const store = useShortcuts(); // read #1, the automatic one
    const forced = store.load(true); // read #2, from the Toolbar pins pane

    gates[1].open();
    // TRUE is the caller's whole question: "is what I am about to decide from the current file?"
    expect(await forced).toBe(true);
    expect(store.shortcuts.value.map((entry) => entry.slug)).toEqual(["fresh"]);

    gates[0].open(); // ...and the overtaken one answers now
    await flushPromises();
    expect(store.shortcuts.value.map((entry) => entry.slug)).toEqual(["fresh"]);
  });

  it("keeps the newest read's result when an overtaken one FAILS", async () => {
    vi.resetModules();
    const gates = [gate(), gate()];
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      const index = call++;
      await gates[index].promise;
      if (index === 0) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ shortcuts: [shortcut("fresh")] }) };
    }) as unknown as typeof fetch;

    const { useShortcuts } = await import("../../../src/composables/useShortcuts");
    const store = useShortcuts();
    const forced = store.load(true);

    gates[1].open();
    expect(await forced).toBe(true);
    gates[0].open();
    await flushPromises();

    // The stale failure must not surface as the current state — neither its list nor its error.
    expect(store.shortcuts.value.map((entry) => entry.slug)).toEqual(["fresh"]);
    expect(store.loadError.value).toBeNull();
  });

  // The pane that asks for a forced read decides whether it may SAVE from the answer, and a read
  // that failed must not read as "confirmed" — false is what makes that decidable at the call site.
  it("answers false when the read itself fails", async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const { useShortcuts } = await import("../../../src/composables/useShortcuts");
    const store = useShortcuts();
    expect(await store.load(true)).toBe(false);
    expect(store.loadError.value).toBe("HTTP 500");
  });
});
