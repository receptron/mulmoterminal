import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// Same stubs as the sibling shared-app spec, for the same reason: what is under test is which face
// of the pane is up, not what the plugin or the panel render inside it.
vi.mock("@mulmoclaude/collection-plugin/vue", () => ({
  CollectionsIndexView: { name: "CollectionsIndexView", template: "<div>index</div>" },
  CollectionView: { name: "CollectionView", template: "<div>collection</div>" },
  FeedsView: { name: "FeedsView", template: "<div>feeds</div>" },
  configureCollectionUi: () => {},
}));
vi.mock("../../../src/components/PluginFrame.vue", () => ({ default: { name: "PluginFrame", template: "<div><slot /></div>" } }));
vi.mock("../../../src/components/SharedAppPreview.vue", () => ({
  default: { name: "SharedAppPreview", props: ["cwd", "pickerTarget"], template: "<div>the preview</div>" },
}));
vi.mock("../../../src/components/SharedAppAccessPanel.vue", () => ({
  default: { name: "SharedAppAccessPanel", props: ["cwd"], template: "<div>who can see what</div>" },
}));

vi.mock("../../../src/composables/collectionProject", () => ({
  projectIdForCwd: async (cwd: string | null) => (cwd === null ? null : "p1"),
}));

const CollectionsPane = (await import("../../../src/components/CollectionsPane.vue")).default;
const { activeCollectionNavSurface } = await import("../../../src/composables/collectionSurface");

function mockDeclared(declared: boolean) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ declared }) }) as unknown as Response) as unknown as typeof fetch;
}

const PREVIEWS = '[data-testid="collections-preview-toggle"]';
const ACCESS = '[data-testid="collections-access-btn"]';

describe("the collections pane's access face", () => {
  it("is offered only where a directory declares a shared app", async () => {
    mockDeclared(false);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/plain" } });
    await flushPromises();
    // No app: nobody is granted anything, so there is no question to put a button on.
    expect(w.find(ACCESS).exists()).toBe(false);
  });

  it("replaces the preview when pressed, rather than sharing the slot with it", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.text()).toContain("the preview");

    await w.find(ACCESS).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("who can see what");
    expect(w.text()).not.toContain("the preview");
    // The two controls report the one state between them: the box that says "you are looking at
    // the pages" must not stay ticked while you are looking at something else.
    expect((w.find(PREVIEWS).element as HTMLInputElement).checked).toBe(false);
    expect(w.find(ACCESS).attributes("aria-pressed")).toBe("true");
  });

  it("gives the slot back when the preview is switched on again", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    await w.find(ACCESS).trigger("click");
    await flushPromises();

    await w.find(PREVIEWS).setValue(true);
    await flushPromises();
    expect(w.text()).toContain("the preview");
    expect(w.find(ACCESS).attributes("aria-pressed")).toBe("false");
  });

  it("closes when a navigation asks for a collection", async () => {
    // The same contract the preview keeps: a click on a collection link is a request FOR that
    // collection, and honouring it behind this panel makes the click look like it did nothing.
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    await w.find(ACCESS).trigger("click");
    await flushPromises();

    activeCollectionNavSurface()?.navigateToRecord("notes", "r1");
    await flushPromises();
    expect(w.text()).not.toContain("who can see what");
    expect(w.text()).toContain("collection");
  });

  it("does not carry one directory's answer into the next", async () => {
    mockDeclared(true);
    const w = mount(CollectionsPane, { props: { cwd: "/srv/app" } });
    await flushPromises();
    await w.find(ACCESS).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("who can see what");

    await w.setProps({ cwd: "/srv/app2" });
    await flushPromises();
    // A panel about permissions is the last thing that may survive the directory it describes.
    expect(w.text()).not.toContain("who can see what");
  });
});
