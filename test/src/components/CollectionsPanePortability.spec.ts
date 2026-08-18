import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// The plugin's Vue surfaces pull a large module graph and render inside a shadow root; none of
// that is what this spec is about (the HOST's portability strip below them is). Stubbed at the
// module boundary so the pane mounts as itself.
vi.mock("@mulmoclaude/collection-plugin/vue", () => ({
  CollectionsIndexView: { name: "CollectionsIndexView", template: "<div />" },
  CollectionView: { name: "CollectionView", template: "<div />" },
  FeedsView: { name: "FeedsView", template: "<div />" },
  // collectionUi.ts binds the package at import time; the pane pulls that module in for its
  // teleport-target helpers, so the mock has to answer for it too.
  configureCollectionUi: () => {},
}));
vi.mock("../../../src/components/PluginFrame.vue", () => ({
  default: { name: "PluginFrame", template: "<div><slot /></div>" },
}));

// The pane resolves its project from the server's list; this cell's cwd IS a known project.
const PROJECT_OF: Record<string, string> = { "/srv/mag2": "p1", "/srv/other": "p2" };
vi.mock("../../../src/composables/collectionProject", () => ({
  projectIdForCwd: async (cwd: string | null) => (cwd === null ? null : (PROJECT_OF[cwd] ?? null)),
}));

// Imported at module scope on purpose — an `await import` inside a test bills the whole module
// graph against that test's timeout (CLAUDE.md).
const CollectionsPane = (await import("../../../src/components/CollectionsPane.vue")).default;
const { activeCollectionNavSurface } = await import("../../../src/composables/collectionSurface");

/** The portability strip's own button. The toolbar above it carries the pane-slot expand and
 *  close controls, so "the first button in the pane" stopped being this one. */
const PORTABILITY = '[data-testid="collections-portability-btn"]';

const REPORT = {
  slug: "newsletters",
  portable: false,
  findings: [
    { code: "data-ignored", severity: "blocker", message: "The data directory is excluded by .gitignore, so the records do not travel." },
    { code: "no-primary-key", severity: "warning", message: "No primaryKey is declared, so record ids are 4 random bytes." },
  ],
};

let lastUrl = "";
function mockFetch(body: unknown, ok = true) {
  lastUrl = "";
  globalThis.fetch = vi.fn((url: string) => {
    lastUrl = String(url);
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
  }) as unknown as typeof fetch;
}

/** Mount the pane and open a collection in it. The pane registers itself as the collection nav
 *  SURFACE while mounted, and that is how the plugin's own views move it — so the test drives the
 *  same seam rather than reaching into the component. (Wrappers auto-unmount after each test, so
 *  the surface a later test finds is its own.) */
async function mountOnCollection(slug = "newsletters") {
  const wrapper = mount(CollectionsPane, { props: { cwd: "/srv/mag2" } });
  await flushPromises();
  const nav = activeCollectionNavSurface();
  if (!nav) throw new Error("the pane did not register a nav surface");
  nav.gotoDetail("collection", slug);
  await flushPromises();
  return { wrapper, nav };
}

describe("CollectionsPane portability strip", () => {
  beforeEach(() => {
    mockFetch(REPORT);
  });

  it("offers nothing while the pane is on the index — the question is per collection", async () => {
    const w = mount(CollectionsPane, { props: { cwd: "/srv/mag2" } });
    await flushPromises();
    expect(w.find(PORTABILITY).exists()).toBe(false);
    // The toolbar is not part of that: it is the pane's own chrome and is there in every state.
    expect(w.find('[data-testid="collections-close-btn"]').exists()).toBe(true);
  });

  it("says so when the directory is not a project the server knows", async () => {
    const w = mount(CollectionsPane, { props: { cwd: "/srv/unknown" } });
    await flushPromises();
    expect(w.text()).toContain("This directory has no collections yet");
    expect(w.find(PORTABILITY).exists()).toBe(false);
    expect(w.find('[data-testid="collections-close-btn"]').exists()).toBe(true);
  });

  it("asks the server for THIS pane's project, and renders what breaks on the other machine", async () => {
    const { wrapper: w } = await mountOnCollection();
    const button = w.find(PORTABILITY);
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    await flushPromises();

    expect(lastUrl).toBe("/api/collections/newsletters/self-containment?project=p1");
    expect(w.text()).toContain("Would not survive a clone");
    // The MESSAGE, not the code — it is the part that says what to do.
    expect(w.text()).toContain("excluded by .gitignore");
    expect(w.text()).toContain("4 random bytes");
  });

  it("reports a clean collection without inventing a finding row", async () => {
    mockFetch({ slug: "newsletters", portable: true, findings: [] });
    const { wrapper: w } = await mountOnCollection();
    await w.find(PORTABILITY).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Nothing to fix");
    expect(w.findAll("li")).toHaveLength(0);
  });

  // `portable` is the verdict; the findings are its reasons. A build that cannot read the reason
  // must still not contradict the verdict — "nothing to fix" is the one thing that may never be
  // said about a report that says the collection does not travel.
  it("never says 'nothing to fix' about a report whose verdict is not portable", async () => {
    mockFetch({ slug: "newsletters", portable: false, findings: [] });
    const { wrapper: w } = await mountOnCollection();
    await w.find(PORTABILITY).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Would not survive a clone");
    expect(w.text()).not.toContain("Nothing to fix");
  });

  // The mirror case, and the one where the client can SEE the contradiction: of the two readings
  // the safe one is the blocker, because a false "it travels" is discovered by someone else, on
  // another machine, days later.
  it("does not call it portable over a blocker it can read", async () => {
    mockFetch({
      slug: "newsletters",
      portable: true,
      findings: [{ code: "sqlite-store", severity: "blocker", message: "Records are one SQLite file; git cannot merge it." }],
    });
    const { wrapper: w } = await mountOnCollection();
    await w.find(PORTABILITY).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Would not survive a clone");
    expect(w.text()).not.toContain("Travels, with caveats");
    // The reason is still shown — the correction is to the headline, not to the report.
    expect(w.text()).toContain("git cannot merge it");
  });

  it("still says 'with caveats' when the findings are only warnings", async () => {
    mockFetch({
      slug: "newsletters",
      portable: true,
      findings: [{ code: "no-primary-key", severity: "warning", message: "No primaryKey is declared." }],
    });
    const { wrapper: w } = await mountOnCollection();
    await w.find(PORTABILITY).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Travels, with caveats");
    expect(w.text()).not.toContain("Would not survive");
  });

  // Focus stays on the button across the whole check, so a verdict that merely APPEARS is one a
  // screen-reader user is never told. The region has to exist before the result lands, or the
  // insertion is not announced at all.
  it("announces the result through a live region that is present before it arrives", async () => {
    const { wrapper: w } = await mountOnCollection();
    const region = w.find('[role="status"]');
    expect(region.exists()).toBe(true);
    expect(region.attributes("aria-live")).toBe("polite");
    expect(region.text()).toBe("");

    await w.find(PORTABILITY).trigger("click");
    await flushPromises();
    // The findings are inside it too: the list IS the answer, not a decoration on it.
    expect(w.find('[role="status"]').text()).toContain("Would not survive a clone");
    expect(w.find('[role="status"]').text()).toContain("excluded by .gitignore");
  });

  it("says the check failed rather than showing a verdict it does not have", async () => {
    mockFetch({}, false);
    const { wrapper: w } = await mountOnCollection();
    await w.find(PORTABILITY).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Could not run the check");
    expect(w.text()).not.toContain("survive");
  });

  // The pair a report describes is (project, collection), and BOTH can change under an in-flight
  // request. A slug-only guard lets project A's verdict land on project B's identically-named
  // collection — the same-slug-in-two-roots collision this feature is about, arriving through a
  // race rather than through a path.
  it("drops a verdict fetched for the previous project when the same slug is reopened", async () => {
    // A fetch the test releases by hand, so the pane can be moved while it is out.
    let release!: (body: unknown) => void;
    const inFlight = new Promise<unknown>((resolve) => (release = resolve));
    globalThis.fetch = vi.fn(
      () => inFlight.then((body) => ({ ok: true, status: 200, json: async () => body })) as unknown as Promise<Response>,
    ) as unknown as typeof fetch;

    const w = mount(CollectionsPane, { props: { cwd: "/srv/mag2" } });
    await flushPromises();
    const navA = activeCollectionNavSurface();
    navA?.gotoDetail("collection", "notes");
    await flushPromises();
    await w.find(PORTABILITY).trigger("click");

    // The cell walks to another project, and the user opens ITS collection of the same name.
    await w.setProps({ cwd: "/srv/other" });
    await flushPromises();
    activeCollectionNavSurface()?.gotoDetail("collection", "notes");
    await flushPromises();

    // Now project A's answer arrives.
    release({ slug: "notes", portable: false, findings: [{ code: "data-ignored", severity: "blocker", message: "A's problem, not B's." }] });
    await flushPromises();

    expect(w.text()).not.toContain("A's problem");
    expect(w.text()).not.toContain("Would not survive a clone");
    // And the superseded request must not have left the button spinning.
    expect(w.find(PORTABILITY).text()).toBe("Survives a clone?");
  });

  // A verdict that outlived the collection it was about would read as the new one's.
  it("drops the report when the pane moves to another collection", async () => {
    const { wrapper: w, nav } = await mountOnCollection();
    await w.find(PORTABILITY).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Would not survive a clone");

    nav.gotoDetail("collection", "other");
    await flushPromises();
    expect(w.text()).not.toContain("Would not survive a clone");
  });
});
