import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AppToolbar from "../../../src/components/AppToolbar.vue";
import { router } from "../../../src/router/index";
import { prsGotoIndex } from "../../../src/composables/usePrsView";

// The toolbar is ONE component rendered by both views (GridView and App), so which buttons
// it offers is decided by the route, not by a prop (#886).
const settle = () => flushPromises();

const labelsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper
    .findAll("nav[aria-label='Views'] button")
    .map((b) => b.attributes("aria-label") ?? b.attributes("title") ?? "")
    .filter(Boolean);

const mountAt = async (path: string) => {
  await router.push(path);
  await settle();
  const wrapper = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
  await settle();
  return wrapper;
};

describe("AppToolbar per-view buttons", () => {
  beforeEach(async () => {
    await router.push("/terminals");
    await settle();
  });

  // Collections is the DOOR to the workspace's own data, and it stands beside the views it is a
  // peer of. It used to be single-view only (#886), which left the content surfaces with no way in
  // at all once that view goes.
  it("offers Collections from the grid", async () => {
    expect(labelsOf(await mountAt("/terminals"))).toEqual(expect.arrayContaining(["Grid view", "Collections"]));
  });

  // Its siblings are NOT always present: one door, not five. A terminal user's row does not grow
  // by four buttons for surfaces they are not in.
  it("does not offer the other content surfaces from the grid", async () => {
    const labels = labelsOf(await mountAt("/terminals"));
    expect(labels).not.toContain("Feeds");
    expect(labels).not.toContain("Wiki");
    expect(labels).not.toContain("Accounting");
    expect(labels).not.toContain("Files");
  });

  // ...and they appear once you are inside, which is what makes the single button a door rather
  // than a dead end.
  it("reveals the sibling surfaces inside the content section", async () => {
    const labels = labelsOf(await mountAt("/collections"));
    expect(labels).toEqual(expect.arrayContaining(["Collections", "Feeds", "Wiki", "Accounting", "Files"]));
  });

  it.each(["/feeds", "/wiki", "/accounting", "/files"])("keeps them revealed on %s, so moving between them does not blink", async (path) => {
    expect(labelsOf(await mountAt(path))).toEqual(expect.arrayContaining(["Feeds", "Wiki", "Accounting", "Files"]));
  });

  // Work under supervision sits with the terminals rather than behind the Collections door, which
  // is why these are not in CONTENT_ROUTES.
  it.each(["Pull requests", "Worklog"])("offers %s on the grid", async (label) => {
    expect(labelsOf(await mountAt("/terminals"))).toContain(label);
  });

  it("offers the grid-running controls on the grid", async () => {
    // The ordering control's accessible name carries the CURRENT mode ("Grid cell ordering:
    // manual (click for auto)"), because with three modes there is no binary aria-pressed to
    // read it from — so match the stable prefix rather than a fixed string (#876).
    const labels = labelsOf(await mountAt("/terminals"));
    expect(labels).toContain("New terminal");
    expect(labels.some((label) => label.startsWith("Grid cell ordering:"))).toBe(true);
  });

  // ...and NOT while a full-screen overlay covers it. They act on cells nobody can see — a new
  // terminal appearing behind the wiki, an ordering change nobody watches — and the rate gauge is
  // status for a view that is not showing.
  it.each(["/collections", "/wiki", "/files", "/accounting", "/prs"])("hides the grid's own controls on %s", async (path) => {
    const labels = labelsOf(await mountAt(path));
    expect(labels).not.toContain("Pull requests");
    expect(labels).not.toContain("Worklog");
    expect(labels).not.toContain("New terminal");
    expect(labels.some((label) => label.startsWith("Grid cell ordering:"))).toBe(false);
  });

  // Nobody is stranded by that: the switch group never hides, so Grid view brings the terminals
  // back and their controls with them.
  it.each(["/collections", "/prs"])("keeps the way back to the grid from %s", async (path) => {
    expect(labelsOf(await mountAt(path))).toContain("Grid view");
  });

  // PRs is the one overlay that is NOT content — it is work under supervision, which belongs with
  // the terminals — so opening it does not reveal the content siblings. The grid's own controls go
  // with the grid, including the PRs button itself: the overlay covers the cells they act on.
  it("shows neither the content siblings nor the grid controls while PRs is open", async () => {
    await router.push("/terminals");
    await settle();
    prsGotoIndex();
    await settle();

    const labels = labelsOf(mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } }));
    expect(labels).not.toContain("Feeds");
    expect(labels).not.toContain("Accounting");
    expect(labels).not.toContain("New terminal");
    expect(labels).toContain("Grid view"); // ...and the way back is always there
  });

  // Regression: the button SET follows the view underneath, but the HIGHLIGHT follows the
  // route. Answering both with one flag lit up Grid view AND Pull requests at once — and,
  // because the overlays live inside App.vue's `!isGrid` block, also stopped the panel
  // rendering at all: the URL changed and the grid just stayed on screen (#892).
  const activeLabels = (wrapper: ReturnType<typeof mount>): string[] =>
    wrapper
      .findAll("nav[aria-label='Views'] button")
      .filter((b) => b.classes().includes("bg-accent-bg"))
      .map((b) => b.attributes("aria-label") ?? b.attributes("title") ?? "");

  it("highlights at most one view, and the grid only while it is showing", async () => {
    await router.push("/terminals");
    await settle();
    const onGrid = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
    expect(activeLabels(onGrid)).toEqual(["Grid view"]);

    // Inside the content section the door stays lit, so there is always something saying where
    // you are.
    await router.push("/collections");
    await settle();
    const onCollections = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
    expect(activeLabels(onCollections)).toEqual(["Collections"]);

    // PRs is the one place with NO highlight: its own button hides with the grid controls, so
    // nothing in the nav is lit. A consequence of hiding them, recorded rather than discovered.
    prsGotoIndex();
    await settle();
    const onPrs = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
    expect(activeLabels(onPrs)).toEqual([]);
  });
});

// #941: the view switch is the only group in the nav that changes WHICH VIEW you are in. It is
// fenced off with a rule; the group makes that structure reach a screen reader too, which a
// border alone never does.
describe("AppToolbar view-switch grouping", () => {
  const switchGroup = (wrapper: ReturnType<typeof mount>) => wrapper.find("nav[aria-label='Views'] [role='group'][aria-label='Switch view']");

  // Collections joined the group when it became a peer of the two views rather than a surface
  // reachable only from one of them. It belongs INSIDE for the reason the group exists: it changes
  // which view fills the screen, where everything to the right of the rule acts within the view
  // you are already in.
  it("groups the two view switches that remain", async () => {
    const group = switchGroup(await mountAt("/terminals"));
    expect(group.exists()).toBe(true);
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Grid view", "Collections"]);
  });

  // The rule is the separator. Losing it turns the nav back into one undifferentiated row,
  // which is the whole bug — and a class change is exactly the edit that would do it silently.
  it("carries the separating rule", async () => {
    expect(switchGroup(await mountAt("/terminals")).classes()).toContain("border-r");
  });

  // Everything else stays OUTSIDE the group — a button that acts WITHIN the current view, swept
  // in, would read as a view switch to a screen reader and sit on the wrong side of the rule.
  it("leaves the within-view buttons out of the group", async () => {
    // The grid, because that is where within-view buttons actually are — New terminal, the
    // ordering control, PRs. On /chat the nav is now the group alone (its content surfaces moved
    // behind the Collections door), so asserting there would pass on an empty nav.
    const wrapper = await mountAt("/terminals");
    const grouped = switchGroup(wrapper).findAll("button").length;
    expect(wrapper.findAll("nav[aria-label='Views'] button").length).toBeGreaterThan(grouped);
  });

  // The revealed siblings are within-view buttons: they move you around INSIDE the content
  // section, so they belong beyond the rule even though the door to that section is inside it.
  it("leaves the revealed siblings out of the group", async () => {
    const group = switchGroup(await mountAt("/collections"));
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Grid view", "Collections"]);
  });
});
