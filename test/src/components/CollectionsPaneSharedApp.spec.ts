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
  default: { name: "SharedAppPreview", props: ["cwd", "pickerTarget"], template: "<div>the preview</div>" },
}));

const PROJECT_OF: Record<string, string> = { "/srv/app": "p1", "/srv/app2": "p3", "/srv/plain": "p2" };
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

/** The toolbar's "Previews" checkbox: ON is the app's pages, OFF the collections under them. */
const PREVIEWS = '[data-testid="collections-preview-toggle"]';

describe("CollectionsPane default view", () => {
  it("opens on the preview in a directory that declares a shared app", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.text()).toContain("the preview");
    // And the checkbox shows that state rather than merely offering it.
    expect((w.find(PREVIEWS).element as HTMLInputElement).checked).toBe(true);
  });

  it("opens on the collections everywhere else", async () => {
    mockDeclared(false);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/plain" } });
    await flushPromises();
    expect(w.text()).not.toContain("the preview");
    expect(w.text()).toContain("index");
    // No app here: no pages, so nothing to switch to.
    expect(w.find(PREVIEWS).exists()).toBe(false);
  });

  it("shows the collections once the box is cleared, and does not re-check itself", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    await w.find(PREVIEWS).setValue(false);
    await flushPromises();
    expect(w.text()).not.toContain("the preview");
    expect(w.text()).toContain("index");
  });

  // The preview's page picker is teleported into the pane's toolbar, so the element the pane hands
  // it has to BE in that toolbar by the time the preview is mounted — a template ref is set after
  // its own render, which is exactly the kind of ordering that silently leaves a picker nowhere.
  it("hands the preview a picker slot that is inside the toolbar", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" }, attachTo: document.body });
    await flushPromises();
    const slot = w.findComponent({ name: "SharedAppPreview" }).props("pickerTarget") as HTMLElement | null;
    expect(slot).toBeInstanceOf(HTMLElement);
    expect(w.find("header, div.border-b").element.contains(slot)).toBe(true);
    w.unmount();
  });

  // Two reviewers landed on the same seam from different sides (#1784): "still on the index" is
  // not the same question as "nobody has steered this pane". Both of these leave `mode ===
  // "index"`, and both are a choice the arriving probe must not overrule.
  it("does not overrule a feeds-index navigation made while the probe was in flight", async () => {
    let release!: () => void;
    mockDeclared(true, new Promise<void>((resolve) => (release = resolve)));
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    activeCollectionNavSurface()?.gotoIndex("feed");
    await flushPromises();

    release();
    await flushPromises();
    expect(w.text()).not.toContain("the preview");
    expect(w.text()).toContain("feeds");
  });

  // A collection link activated from another mounted card is routed to this surface. With the
  // preview up and nothing clearing it, the request would be honoured behind the preview and the
  // click would look like it did nothing.
  it("leaves the preview when a navigation asks for a collection", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.text()).toContain("the preview");

    activeCollectionNavSurface()?.navigateToRecord("notes", "r1");
    await flushPromises();
    expect(w.text()).not.toContain("the preview");
    expect(w.text()).toContain("collection");
    expect((w.find(PREVIEWS).element as HTMLInputElement).checked).toBe(false);
  });

  // The default is per DIRECTORY: walking the cell to another shared app is a fresh start, not a
  // pane the user has steered.
  it("defaults again when the cell moves to another directory", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    await w.find(PREVIEWS).setValue(false);
    await flushPromises();
    expect(w.text()).not.toContain("the preview");

    await w.setProps({ cwd: "/srv/app2" });
    await flushPromises();
    expect(w.text()).toContain("the preview");
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
