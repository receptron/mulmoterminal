import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AppToolbar from "../../../src/components/AppToolbar.vue";
import { router } from "../../../src/router/index";
import { prsGotoIndex } from "../../../src/composables/usePrsView";
import { browseGotoIndex } from "../../../src/composables/useCollectionBrowse";

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
    await router.push({ name: "chat" });
    await settle();
  });

  // Collections is the DOOR to the workspace's own data, and it stands beside the views it is a
  // peer of. It used to be single-view only (#886), which left the content surfaces with no way in
  // at all once that view goes.
  it.each(["/chat", "/terminals"])("offers Collections from %s", async (path) => {
    expect(labelsOf(await mountAt(path))).toEqual(expect.arrayContaining(["Chat", "Grid view", "Collections"]));
  });

  // Its siblings are NOT always present: one door, not five. A terminal user's row does not grow
  // by four buttons for surfaces they are not in.
  it.each(["/chat", "/terminals"])("does not offer the other content surfaces from %s", async (path) => {
    const labels = labelsOf(await mountAt(path));
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

  // Both views keep the pair that switches between them — hiding either would strand a user
  // in whichever view they were in.
  it("keeps the view switch in both views", async () => {
    expect(labelsOf(await mountAt("/chat"))).toEqual(expect.arrayContaining(["Chat", "Grid view"]));
    expect(labelsOf(await mountAt("/terminals"))).toEqual(expect.arrayContaining(["Chat", "Grid view"]));
  });

  // The two reference surfaces you consult WHILE supervising, so they sit in the grid's own
  // nav rather than the single view's content cluster.
  it.each(["Pull requests", "Worklog"])("offers %s only in the grid", async (label) => {
    expect(labelsOf(await mountAt("/terminals"))).toContain(label);
    expect(labelsOf(await mountAt("/chat"))).not.toContain(label);
  });

  it("offers the grid-running controls only in the grid", async () => {
    // The ordering control's accessible name carries the CURRENT mode ("Grid cell ordering:
    // manual (click for auto)"), because with three modes there is no binary aria-pressed to
    // read it from — so match the stable prefix rather than a fixed string (#876).
    const hasOrdering = (labels: string[]) => labels.some((label) => label.startsWith("Grid cell ordering:"));
    const grid = labelsOf(await mountAt("/terminals"));
    expect(grid).toContain("New terminal");
    expect(hasOrdering(grid)).toBe(true);
    const single = labelsOf(await mountAt("/chat"));
    expect(single).not.toContain("New terminal");
    expect(hasOrdering(single)).toBe(false);
  });

  // The overlays render BELOW the header (`top-10`), so the header stays on screen while one
  // is open. Switching to the other view's buttons there would take away the very button the
  // user just clicked — and would swap the shell behind the panel (#892).
  it("keeps the grid buttons while an overlay opened FROM the grid is on screen", async () => {
    await router.push("/terminals");
    await settle();
    prsGotoIndex();
    await settle();

    const labels = labelsOf(mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } }));
    expect(labels).toContain("Pull requests");
    expect(labels).toContain("Worklog");
    // PRs is the one overlay that is NOT content — it is work under supervision, which belongs
    // with the grid — so opening it does not reveal the content siblings.
    expect(labels).not.toContain("Feeds");
    expect(labels).not.toContain("Accounting");
  });

  it("keeps the single-view buttons while an overlay opened from the single view is on screen", async () => {
    await router.push({ name: "chat" });
    await settle();
    browseGotoIndex("collection");
    await settle();

    const labels = labelsOf(mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } }));
    expect(labels).toContain("Collections");
    expect(labels).not.toContain("Pull requests");
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

  it("highlights exactly one view, even with a grid-opened overlay on screen", async () => {
    await router.push("/terminals");
    await settle();
    const onGrid = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
    expect(activeLabels(onGrid)).toEqual(["Grid view"]);

    prsGotoIndex();
    await settle();
    const onPrs = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
    expect(activeLabels(onPrs)).toEqual(["Pull requests"]);
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
  it.each(["/chat", "/terminals"])("groups exactly the three view switches (%s)", async (path) => {
    const group = switchGroup(await mountAt(path));
    expect(group.exists()).toBe(true);
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Chat", "Grid view", "Collections"]);
  });

  // The rule is the separator. Losing it turns the nav back into one undifferentiated row,
  // which is the whole bug — and a class change is exactly the edit that would do it silently.
  it("carries the separating rule", async () => {
    expect(switchGroup(await mountAt("/chat")).classes()).toContain("border-r");
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
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Chat", "Grid view", "Collections"]);
  });
});
