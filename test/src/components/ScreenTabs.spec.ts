import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import ScreenTabs from "../../../src/components/ScreenTabs.vue";
import { closeScreenTab, screenTabs } from "../../../src/composables/useScreenTabs";
import { libraryViewOpen } from "../../../src/composables/useLibraryView";
import { overlayOriginState } from "../../../src/composables/overlayOrigin";
import { en } from "../../../src/i18n/en";

const here = () => router.currentRoute.value;
const open = async (name: string) => {
  await router.push({ name, state: overlayOriginState() });
  await flushPromises();
};

beforeEach(async () => {
  await router.push("/terminals");
  await flushPromises();
  [...screenTabs.value].forEach((tab) => closeScreenTab(tab.key));
  await flushPromises();
});

describe("ScreenTabs", () => {
  it("is up only while a screen is in front, the terminals first and the screens in the order opened", async () => {
    const w = mount(ScreenTabs);
    expect(w.find("[data-screen-tabs]").exists()).toBe(false);
    await open("skills");
    libraryViewOpen({ session: "s1", cwd: null });
    await flushPromises();
    const labels = w.findAll("nav span.truncate").map((label) => label.text());
    expect(labels).toEqual([en.tips.toolbar.gridLabel, en.featureMenu.items.skills.label, en.featureMenu.items.library.label]);
    expect(w.get("[aria-current=page] span.truncate").text()).toBe(en.featureMenu.items.library.label);
    await router.push("/terminals");
    await flushPromises();
    expect(w.find("[data-screen-tabs]").exists()).toBe(false);
    w.unmount();
  });

  it("goes to a tab's screen where it was left, and back to the terminals", async () => {
    const w = mount(ScreenTabs);
    await router.push({ name: "library", query: { session: "s1" }, hash: "#turn-3", state: overlayOriginState() });
    await flushPromises();
    await open("usage");
    await w.findAll("[data-testid=screen-tab]")[0]?.trigger("click");
    await flushPromises();
    expect(here().name).toBe("library");
    expect(here().query).toEqual({ session: "s1" });
    expect(here().hash).toBe("#turn-3");
    await w.get("nav > button").trigger("click");
    await flushPromises();
    expect(here().name).toBe("terminals");
    w.unmount();
  });

  it("closing the tab in front shows the next one, and the last one goes back to the terminals", async () => {
    const w = mount(ScreenTabs);
    await open("rooms");
    await open("skills");
    await open("usage");
    await open("skills");
    await w.get(`[aria-label="${en.screenTabs.close.replace("{screen}", en.featureMenu.items.skills.label)}"]`).trigger("click");
    await flushPromises();
    expect(here().name).toBe("usage");
    expect(screenTabs.value.map((tab) => tab.screen)).toEqual(["rooms", "usage"]);
    closeScreenTab("rooms");
    await flushPromises();
    expect(here().name).toBe("usage");
    closeScreenTab("usage");
    await flushPromises();
    expect(here().name).toBe("terminals");
    expect(screenTabs.value).toEqual([]);
    w.unmount();
  });

  it("closing the first tab while it is in front shows the one after it", async () => {
    await open("rooms");
    await open("skills");
    await open("rooms");
    await closeScreenTab("rooms");
    await flushPromises();
    expect(here().name).toBe("skills");
  });

  it("keeps one tab per screen, however many places inside it were visited", async () => {
    await open("blueprints");
    await open("blueprintMarket");
    await open("wiki");
    await open("wikiGraph");
    expect(screenTabs.value.map(({ screen, path }) => ({ screen, path }))).toEqual([
      { screen: "blueprints", path: "/blueprints/market" },
      { screen: "wiki", path: "/wiki/graph" },
    ]);
  });
});

describe("closing a tab from the keyboard", () => {
  it("hands the keyboard to the tab now in front", async () => {
    const w = mount(ScreenTabs, { attachTo: document.body });
    await open("rooms");
    await open("skills");
    const closeSkills = w.get(`[aria-label="${en.screenTabs.close.replace("{screen}", en.featureMenu.items.skills.label)}"]`);
    (closeSkills.element as HTMLElement).focus();
    await closeSkills.trigger("click");
    await flushPromises();
    expect(document.activeElement?.getAttribute("aria-current")).toBe("page");
    expect(document.activeElement?.textContent).toContain(en.featureMenu.items.rooms.label);
    w.unmount();
  });
});

describe("a tab per collection and feed", () => {
  let artTitle: string | null = "Art collection";
  const listed = (url: string): unknown =>
    url.startsWith("/api/feeds")
      ? { feeds: [{ slug: "hn", title: "Hacker News", icon: "newspaper" }] }
      : { collections: artTitle === null ? [] : [{ slug: "art", title: artTitle, icon: "palette" }] };
  let hold: Promise<void> | null = null;
  const fetched: string[] = [];
  let failing = false;

  beforeEach(() => {
    fetched.length = 0;
    failing = false;
    artTitle = "Art collection";
    hold = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        const body = failing ? null : JSON.stringify(listed(url));
        if (hold) await hold;
        return body === null ? new Response("down", { status: 500 }) : new Response(body, { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const labels = (w: ReturnType<typeof mount>) => w.findAll("[data-testid=screen-tab] span.truncate").map((label) => label.text());
  const openPath = async (fullPath: string) => {
    const { path, query } = router.resolve(fullPath);
    await router.push({ path, query, state: overlayOriginState() });
    await flushPromises();
  };

  it("keeps the index and each opened collection and feed apart, each named by its list", async () => {
    const w = mount(ScreenTabs);
    await openPath("/collections");
    await openPath("/feeds/hn");
    await openPath("/collections/art");
    await openPath("/collections/travel");
    await openPath("/collections");
    expect(labels(w)).toEqual([en.tips.toolbar.collections, "Art collection", "travel", "Hacker News"]);
    expect(w.get("[aria-current=page] span.truncate").text()).toBe(en.tips.toolbar.collections);
    w.unmount();
  });

  it("switches to an open collection's tab instead of adding another, and closes it alone", async () => {
    const w = mount(ScreenTabs);
    await openPath("/collections/art");
    await openPath("/collections");
    await openPath("/collections/art");
    expect(labels(w)).toEqual([en.tips.toolbar.collections, "Art collection"]);
    expect(w.get("[aria-current=page] span.truncate").text()).toBe("Art collection");
    await w.findAll("[data-testid=screen-tab]")[0]?.trigger("click");
    await flushPromises();
    expect(here().path).toBe("/collections");
    await w.get(`[aria-label="${en.screenTabs.close.replace("{screen}", "Art collection")}"]`).trigger("click");
    await flushPromises();
    expect(labels(w)).toEqual([en.tips.toolbar.collections]);
    expect(here().path).toBe("/collections");
    w.unmount();
  });

  it("reads a project's list with that project, once per visit to one of its tabs and not in between", async () => {
    const w = mount(ScreenTabs);
    await openPath("/collections/art?project=p1");
    await openPath("/collections/art");
    expect(fetched.filter((url) => url.includes("project=p1"))).toHaveLength(1);
    await openPath("/collections/art?project=p1");
    expect(labels(w)).toEqual(["Art collection", "Art collection"]);
    expect(fetched.filter((url) => url.includes("project=p1"))).toHaveLength(2);
    w.unmount();
  });

  it("picks up a rename when the renamed item's tab is shown again", async () => {
    const w = mount(ScreenTabs);
    await openPath("/collections/art?project=p3");
    await openPath("/collections?project=p3");
    artTitle = "Paintings";
    await openPath("/collections?project=p3");
    expect(labels(w)).toEqual([en.tips.toolbar.collections, "Art collection"]);
    await w.findAll("[data-testid=screen-tab]")[1]?.trigger("click");
    await flushPromises();
    expect(labels(w)).toEqual([en.tips.toolbar.collections, "Paintings"]);
    w.unmount();
  });

  it("names a tab whose list failed once it answers on a later visit, without retrying in a loop", async () => {
    const w = mount(ScreenTabs);
    failing = true;
    await openPath("/collections/art?project=p2");
    expect(labels(w)).toEqual(["art"]);
    const failedReads = fetched.filter((url) => url.includes("project=p2")).length;
    expect(failedReads).toBe(1);
    await flushPromises();
    expect(fetched.filter((url) => url.includes("project=p2"))).toHaveLength(failedReads);
    failing = false;
    await openPath("/collections?project=p2");
    expect(labels(w)).toEqual([en.tips.toolbar.collections, "Art collection"]);
    w.unmount();
  });

  it("drops a deleted item's name when its tab is shown again", async () => {
    const w = mount(ScreenTabs);
    await openPath("/collections/art?project=p4");
    await openPath("/collections?project=p4");
    artTitle = null;
    await w.findAll("[data-testid=screen-tab]")[1]?.trigger("click");
    await flushPromises();
    expect(labels(w)).toEqual([en.tips.toolbar.collections, "art"]);
    w.unmount();
  });

  it("reads once more for a visit made while its list was being read", async () => {
    const w = mount(ScreenTabs);
    let release = (): void => undefined;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPath("/collections/art?project=p5");
    await openPath("/collections?project=p5");
    artTitle = "Paintings";
    await w.findAll("[data-testid=screen-tab]")[1]?.trigger("click");
    await flushPromises();
    expect(fetched.filter((url) => url.includes("project=p5"))).toHaveLength(1);
    hold = null;
    release();
    await flushPromises();
    expect(labels(w)).toEqual([en.tips.toolbar.collections, "Paintings"]);
    expect(fetched.filter((url) => url.includes("project=p5"))).toHaveLength(2);
    w.unmount();
  });
});
