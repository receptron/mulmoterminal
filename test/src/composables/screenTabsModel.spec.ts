import { describe, it, expect } from "vitest";
import { closeTab, screenOfRoute, visitTab, type ScreenTab } from "../../../src/composables/screenTabsModel";
import { PALETTE_SCREENS } from "../../../src/composables/paletteScreens";
import { router } from "../../../src/router/index";

const tab = (screen: ScreenTab["screen"], path = `/${screen}`): ScreenTab => ({ screen, path });

describe("screenOfRoute", () => {
  it("groups a screen's routes under it", () => {
    expect(screenOfRoute("roomView")).toBe("rooms");
    expect(screenOfRoute("blueprintMarket")).toBe("blueprints");
    expect(screenOfRoute("wikiPage")).toBe("wiki");
    expect(screenOfRoute("githubBoard")).toBe("prs");
    expect(screenOfRoute("library")).toBe("library");
  });

  it("is null for the terminals and for anything that is not a route name", () => {
    ["terminals", "single", "", "toString", "__proto__", null, undefined, 7, Symbol("library")].forEach((name) =>
      expect(screenOfRoute(name), String(name)).toBeNull(),
    );
  });

  // Every screen but the terminals has a route the tabs know, and every route they know exists.
  it("covers every screen, through routes the router has", () => {
    const names = router.getRoutes().map((route) => String(route.name));
    const covered = new Set(names.map(screenOfRoute).filter((screen) => screen !== null));
    expect(PALETTE_SCREENS.filter((screen) => !covered.has(screen))).toEqual(["terminals", "worklog"]);
  });
});

describe("visitTab", () => {
  it("adds a new screen last and moves an open one to where it now is, keeping the order", () => {
    const one = visitTab([], "library", "/library");
    const two = visitTab(one, "skills", "/skills");
    expect(two).toEqual([tab("library"), tab("skills")]);
    expect(visitTab(two, "library", "/library?session=s")).toEqual([tab("library", "/library?session=s"), tab("skills")]);
  });

  it("leaves the list it was given alone", () => {
    const tabs = [tab("rooms")];
    visitTab(tabs, "rooms", "/rooms/a");
    visitTab(tabs, "usage", "/usage");
    expect(tabs).toEqual([tab("rooms")]);
  });
});

describe("closeTab", () => {
  const three = [tab("rooms"), tab("library"), tab("usage")];

  it("shows the one after a closed tab, else the one before, else none", () => {
    expect(closeTab(three, "library")).toEqual({ tabs: [tab("rooms"), tab("usage")], next: tab("usage") });
    expect(closeTab(three, "usage")).toEqual({ tabs: [tab("rooms"), tab("library")], next: tab("library") });
    expect(closeTab([tab("rooms")], "rooms")).toEqual({ tabs: [], next: null });
  });

  it("changes nothing for a screen with no tab", () => {
    expect(closeTab(three, "skills")).toEqual({ tabs: three, next: null });
    expect(closeTab([], "skills")).toEqual({ tabs: [], next: null });
  });
});
