import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AppToolbar from "../../../src/components/AppToolbar.vue";
import { router } from "../../../src/router/index";
import { githubGotoIndex } from "../../../src/composables/useGithubView";
import { setToolbarPins } from "../../../src/composables/toolbarPins";
import { collectionChatKey, holdCollectionChat, resetCollectionChats } from "../../../src/composables/collectionChatSessions";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";
import type { Shortcut } from "../../../common/shortcuts";

// The pinned favourites the toolbar draws from (#1984). Stubbed rather than fetched: the real store
// loads them over /api/shortcuts, which is a request every mount in this file would otherwise make.
const pinned = vi.hoisted((): { current: Shortcut[] } => ({ current: [] }));
vi.mock("../../../src/composables/useShortcuts", async () => {
  const { computed } = await import("vue");
  return { useShortcuts: () => ({ shortcuts: computed(() => pinned.current) }) };
});

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
    githubGotoIndex();
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

  // Codex, on this PR. The door has to stay lit on the DETAIL pages, not just the index — opening
  // one of the things behind it does not take you out of the section. With the grid's own controls
  // hidden under an overlay, nothing else would be lit either, so the toolbar would show no
  // selected destination at all while you are plainly inside collections.
  it.each([
    ["/collections/todos", "Collections"],
    ["/feeds/news", "Feeds"],
  ])("keeps the door lit on %s", async (path, label) => {
    const wrapper = await mountAt(path);
    const lit = wrapper
      .findAll("nav[aria-label='Views'] button")
      .filter((b) => b.classes().includes("bg-accent-bg"))
      .map((b) => b.attributes("aria-label"));
    expect(lit).toEqual([label]);
  });

  it("lights the collections door for a collection and not for a feed, on their detail pages", async () => {
    // The two doors must not both light: they are different sections that share a component.
    const wrapper = await mountAt("/collections/todos");
    const labels = wrapper
      .findAll("nav[aria-label='Views'] button")
      .filter((b) => b.classes().includes("bg-accent-bg"))
      .map((b) => b.attributes("aria-label"));
    expect(labels).not.toContain("Feeds");
  });

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
    githubGotoIndex();
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

// #2001: a chat running in the collection pane is not a grid cell, so nothing else on this screen
// says it exists. The door it lives behind wears the count.
describe("AppToolbar collection chat badge", () => {
  const works = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null) ?? "";
  const chat = (id: string): SpawnedChatRequest => ({ id, agent: "claude", draft: false });
  const badge = (wrapper: ReturnType<typeof mount>) => wrapper.findAll("nav[aria-label='Views'] span").filter((s) => /^\d+$|99\+/.test(s.text().trim()));
  const door = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll("nav[aria-label='Views'] button").find((b) => (b.attributes("aria-label") ?? "").startsWith("Collections"));

  beforeEach(resetCollectionChats);
  afterEach(resetCollectionChats);

  it("wears nothing while no chat is running there", async () => {
    const wrapper = await mountAt("/terminals");
    expect(badge(wrapper)).toHaveLength(0);
    expect(door(wrapper)?.attributes("aria-label")).toBe("Collections"); // ...and the name is unchanged
  });

  it("counts the chats filed under collections", async () => {
    holdCollectionChat(works, chat("a"));
    holdCollectionChat(works, chat("b"));
    const wrapper = await mountAt("/terminals");
    expect(badge(wrapper)[0].text()).toBe("2");
  });

  // The badge is aria-hidden, so the accessible name has to say it too — otherwise a screen reader
  // is told less than the screen shows.
  it("says it in the button's own name", async () => {
    holdCollectionChat(works, chat("a"));
    const wrapper = await mountAt("/terminals");
    expect(door(wrapper)?.attributes("aria-label")).toBe("Collections — 1 chat open here");
  });
});

// #1984: a few pinned collections get a permanent button here, so opening one is a single press
// instead of Collections-then-the-row-inside-it.
describe("AppToolbar pinned collections", () => {
  const works: Shortcut = { kind: "collection", slug: "works", title: "Work log", icon: "task" };
  const news: Shortcut = { kind: "feed", slug: "news", title: "News", icon: "rss_feed" };
  const pinGroup = (wrapper: ReturnType<typeof mount>) => wrapper.find("nav[aria-label='Views'] [role='group'][aria-label='Pinned collections and feeds']");

  beforeEach(() => {
    pinned.current = [works, news];
    setToolbarPins([]);
  });

  afterEach(() => {
    pinned.current = [];
    setToolbarPins([]);
  });

  // The empty case is the one that must not cost anything: an install that promoted nothing has to
  // get the header it had, rule included.
  it("draws nothing at all while none is promoted", async () => {
    const wrapper = await mountAt("/terminals");
    expect(pinGroup(wrapper).exists()).toBe(false);
    expect(labelsOf(wrapper)).not.toContain("Work log");
  });

  it("offers the promoted ones, in the configured order", async () => {
    setToolbarPins(["feed:news", "collection:works"]);
    const group = pinGroup(await mountAt("/terminals"));
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["News", "Work log"]);
  });

  // Only the promoted ones: the whole point is that the row does not grow by every favourite.
  it("leaves the un-promoted favourites off the toolbar", async () => {
    setToolbarPins(["collection:works"]);
    expect(labelsOf(await mountAt("/terminals"))).not.toContain("News");
  });

  // Not a grid control: it changes which view fills the screen, so it stays put when you are
  // inside the content section rather than moving with the buttons that act on cells.
  it.each(["/terminals", "/collections", "/wiki"])("keeps them on %s", async (path) => {
    setToolbarPins(["collection:works"]);
    expect(labelsOf(await mountAt(path))).toContain("Work log");
  });

  // Their own fenced group, on the view-switch side of the rule — pressing one leaves the view you
  // are in, which is what everything left of the fence does.
  it("fences them off without joining the view switch", async () => {
    setToolbarPins(["collection:works"]);
    const wrapper = await mountAt("/terminals");
    expect(pinGroup(wrapper).classes()).toContain("border-r");
    const switchGroup = wrapper.find("nav[aria-label='Views'] [role='group'][aria-label='Switch view']");
    expect(switchGroup.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Grid view", "Collections"]);
  });

  it("opens the collection in one press", async () => {
    setToolbarPins(["collection:works"]);
    const wrapper = await mountAt("/terminals");
    await pinGroup(wrapper).findAll("button")[0].trigger("click");
    await settle();
    expect(router.currentRoute.value.path).toBe("/collections/works");
  });

  it("lights the one you are looking at", async () => {
    setToolbarPins(["collection:works", "feed:news"]);
    const wrapper = await mountAt("/collections/works");
    const lit = pinGroup(wrapper)
      .findAll("button")
      .filter((b) => b.classes().includes("bg-accent-bg"))
      .map((b) => b.attributes("aria-label"));
    expect(lit).toEqual(["Work log"]);
  });

  // The title and icon come from the pin, so a favourite that is gone — unpinned here or in
  // MulmoClaude, which writes the same file — has nothing to draw and is skipped rather than
  // rendered as a blank button.
  it("skips a promoted key whose pin is gone", async () => {
    setToolbarPins(["collection:works", "collection:deleted"]);
    const group = pinGroup(await mountAt("/terminals"));
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Work log"]);
  });
});
