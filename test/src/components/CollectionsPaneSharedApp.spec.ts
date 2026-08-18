import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// The plugin's Vue surfaces and the preview both pull large module graphs and render inside a
// shadow root; neither is what this spec is about (which VIEW the pane opens in is). Stubbed at
// the module boundary so the pane mounts as itself.
vi.mock("@mulmoclaude/collection-plugin/vue", () => ({
  CollectionsIndexView: { name: "CollectionsIndexView", template: "<div>index</div>" },
  CollectionView: { name: "CollectionView", template: "<div>collection</div>" },
  FeedsView: { name: "FeedsView", template: "<div>feeds</div>" },
  configureCollectionUi: () => {},
}));
vi.mock("../../../src/components/PluginFrame.vue", () => ({
  default: { name: "PluginFrame", template: "<div><slot /></div>" },
}));
vi.mock("../../../src/components/SharedAppPreview.vue", () => ({
  default: { name: "SharedAppPreview", template: "<div>the preview</div>" },
}));

const PROJECT_OF: Record<string, string> = { "/srv/app": "p1", "/srv/plain": "p2" };
vi.mock("../../../src/composables/collectionProject", () => ({
  projectIdForCwd: async (cwd: string | null) => (cwd === null ? null : (PROJECT_OF[cwd] ?? null)),
}));

// Imported at module scope on purpose — an `await import` inside a test bills the whole module
// graph against that test's timeout (CLAUDE.md).
const CollectionsPane = (await import("../../../src/components/CollectionsPane.vue")).default;
const { activeCollectionNavSurface } = await import("../../../src/composables/collectionSurface");

/** Answer the declared-app probe, and nothing else: no other route is reached in these tests. */
function mockDeclared(declared: boolean, hold?: Promise<void>) {
  globalThis.fetch = vi.fn(async () => {
    if (hold) await hold;
    return { ok: true, status: 200, json: async () => ({ declared }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("CollectionsPane default view", () => {
  it("opens on the preview in a directory that declares a shared app", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.text()).toContain("the preview");
    // And the way back is on the toolbar, not lost.
    expect(w.text()).toContain("Back to collections");
  });

  it("opens on the collections everywhere else", async () => {
    mockDeclared(false);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/plain" } });
    await flushPromises();
    expect(w.text()).not.toContain("the preview");
    expect(w.text()).toContain("index");
  });

  it("leaves the preview once the user goes back, and does not re-open it", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    await w.find("button").trigger("click"); // Back to collections
    await flushPromises();
    expect(w.text()).not.toContain("the preview");
    expect(w.text()).toContain("Preview the shared app");
  });

  // The probe is async. Someone who opened a collection while it was in flight has said what they
  // want on screen; taking it off them after the fact is worse than not defaulting at all.
  it("does not steal the screen from a collection opened while the probe was in flight", async () => {
    let release!: () => void;
    mockDeclared(true, new Promise<void>((resolve) => (release = resolve)));
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    activeCollectionNavSurface()?.gotoDetail("collection", "notes");
    await flushPromises();

    release();
    await flushPromises();
    expect(w.text()).not.toContain("the preview");
    expect(w.text()).toContain("collection");
  });
});
