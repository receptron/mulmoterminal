import { describe, it, expect, beforeEach } from "vitest";
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
  [...screenTabs.value].forEach((tab) => closeScreenTab(tab.screen));
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
    libraryViewOpen({ session: "s1", cwd: null });
    await flushPromises();
    await open("usage");
    await w.findAll("[data-testid=screen-tab]")[0]?.trigger("click");
    await flushPromises();
    expect(here().name).toBe("library");
    expect(here().query).toEqual({ session: "s1" });
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

  it("keeps one tab per screen, however many places inside it were visited", async () => {
    await open("blueprints");
    await open("blueprintMarket");
    await open("wiki");
    await open("wikiGraph");
    expect(screenTabs.value).toEqual([
      { screen: "blueprints", path: "/blueprints/market" },
      { screen: "wiki", path: "/wiki/graph" },
    ]);
  });
});
