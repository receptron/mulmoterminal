import { describe, it, expect } from "vitest";
import { closeTab, screenOfRoute, tabOfRoute, visitTab, type ScreenTab, type ScreenTabTarget, type TabRoute } from "../../../src/composables/screenTabsModel";
import { PALETTE_SCREENS } from "../../../src/composables/paletteScreens";
import { router } from "../../../src/router/index";
import { OVERLAY_ROUTES } from "../../../src/composables/overlayOrigin";

const target = (screen: ScreenTab["screen"]): ScreenTabTarget => ({ key: screen, screen, item: null });
const tab = (screen: ScreenTab["screen"], path = `/${screen}`): ScreenTab => ({ ...target(screen), path });
const route = (name: string, params: Record<string, unknown> = {}, query: Record<string, unknown> = {}): TabRoute => ({ name, params, query });
const itemTarget = (screen: ScreenTab["screen"], slug: string, project: string | null = null): ScreenTabTarget => {
  const found = tabOfRoute(route(screen === "feeds" ? "feedDetail" : "collectionDetail", { slug }, project ? { project } : {}));
  if (found === null) throw new Error(`no tab for ${slug}`);
  return found;
};
const itemTab = (screen: ScreenTab["screen"], slug: string, project: string | null = null): ScreenTab => ({
  ...itemTarget(screen, slug, project),
  path: `/${screen}/${slug}`,
});

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

  // Every full-screen route is some screen's: a route added to the screens without a tab would open
  // a screen with no tab in front.
  it("maps every full-screen route to its screen", () => {
    const expected: Record<string, string> = {
      ...{ collections: "collections", collectionDetail: "collections", feeds: "feeds", feedDetail: "feeds", accounting: "accounting", files: "files" },
      ...{ wiki: "wiki", wikiPage: "wiki", wikiGraph: "wiki", wikiLint: "wiki", github: "prs", githubBoard: "prs" },
      ...{ rooms: "rooms", roomView: "rooms", blueprints: "blueprints", blueprintRun: "blueprints", blueprintMarket: "blueprints" },
      ...{ skills: "skills", library: "library", processes: "processes", usage: "usage" },
    };
    expect(Object.fromEntries([...OVERLAY_ROUTES].map((name) => [name, screenOfRoute(name)]))).toEqual(expected);
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
    const one = visitTab([], target("library"), "/library");
    const two = visitTab(one, target("skills"), "/skills");
    expect(two).toEqual([tab("library"), tab("skills")]);
    expect(visitTab(two, target("library"), "/library?session=s")).toEqual([tab("library", "/library?session=s"), tab("skills")]);
  });

  it("leaves the list it was given alone", () => {
    const tabs = [tab("rooms")];
    visitTab(tabs, target("rooms"), "/rooms/a");
    visitTab(tabs, target("usage"), "/usage");
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

describe("tabOfRoute", () => {
  it("gives the index routes and every other screen route its screen's own tab", () => {
    expect(tabOfRoute(route("collections"))).toEqual(target("collections"));
    expect(tabOfRoute(route("feeds", {}, { project: "p1" }))).toEqual(target("feeds"));
    expect(tabOfRoute(route("roomView", { room: "r1" }))).toEqual(target("rooms"));
    expect(tabOfRoute(route("blueprintRun", { run: "b1" }))).toEqual(target("blueprints"));
    expect(tabOfRoute(route("wikiPage", { slug: "home" }))).toEqual(target("wiki"));
  });

  it("gives each collection and feed page a tab of its own, keyed by project and slug", () => {
    const art = tabOfRoute(route("collectionDetail", { slug: "art" }));
    expect(art).toMatchObject({ screen: "collections", item: { slug: "art", project: null } });
    expect(tabOfRoute(route("feedDetail", { slug: "hn" }, { project: "p1" }))).toMatchObject({ screen: "feeds", item: { slug: "hn", project: "p1" } });
    const keys = [
      art,
      tabOfRoute(route("collectionDetail", { slug: "art" }, { project: "p1" })),
      tabOfRoute(route("collectionDetail", { slug: "travel" })),
      tabOfRoute(route("feedDetail", { slug: "art" })),
      tabOfRoute(route("collections")),
    ].map((found) => found?.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores what does not change which item is open", () => {
    const plain = tabOfRoute(route("collectionDetail", { slug: "art" }));
    expect(tabOfRoute(route("collectionDetail", { slug: "art" }, { record: "x", project: "" }))).toEqual(plain);
  });

  it("falls back to the screen's tab for a page with no usable slug, and is null off the screens", () => {
    [undefined, "", 7, ["art"]].forEach((slug) => expect(tabOfRoute(route("collectionDetail", { slug })), String(slug)).toEqual(target("collections")));
    expect(tabOfRoute(route("collectionDetail", { slug: "art" }, { project: ["p1"] }))?.item).toEqual({ slug: "art", project: null });
    expect(tabOfRoute(route("terminals"))).toBeNull();
    expect(tabOfRoute({ params: {}, query: {} })).toBeNull();
  });
});

describe("visitTab with item tabs", () => {
  it("puts a new item after the last tab of its screen, and an index before its screen's first item", () => {
    const start = [tab("collections"), tab("prs")];
    const art = visitTab(start, itemTarget("collections", "art"), "/collections/art");
    const travel = visitTab(art, itemTarget("collections", "travel"), "/collections/travel");
    expect(travel.map((entry) => entry.item?.slug ?? entry.screen)).toEqual(["collections", "art", "travel", "prs"]);
    const withoutIndex = closeTab(travel, "collections").tabs;
    const back = visitTab(withoutIndex, target("collections"), "/collections");
    expect(back.map((entry) => entry.item?.slug ?? entry.screen)).toEqual(["collections", "art", "travel", "prs"]);
  });

  it("adds an item with no tab of its screen open last", () => {
    expect(visitTab([tab("prs")], itemTarget("feeds", "hn"), "/feeds/hn").map((entry) => entry.item?.slug ?? entry.screen)).toEqual(["prs", "hn"]);
  });

  it("switches to an item already open instead of adding it again", () => {
    const tabs = [tab("collections"), itemTab("collections", "art"), itemTab("collections", "travel")];
    const again = visitTab(tabs, itemTarget("collections", "art"), "/collections/art?project=");
    expect(again).toHaveLength(3);
    expect(again[1]?.path).toBe("/collections/art?project=");
  });

  it("keeps the same slug in two projects as two tabs", () => {
    const one = visitTab([], itemTarget("collections", "tasks"), "/collections/tasks");
    expect(visitTab(one, itemTarget("collections", "tasks", "p1"), "/collections/tasks?project=p1")).toHaveLength(2);
  });

  it("closes an item tab by its key, leaving the index and the other items", () => {
    const tabs = [tab("collections"), itemTab("collections", "art"), itemTab("collections", "travel")];
    const { tabs: rest, next } = closeTab(tabs, itemTarget("collections", "art").key);
    expect(rest.map((entry) => entry.item?.slug ?? entry.screen)).toEqual(["collections", "travel"]);
    expect(next?.item?.slug).toBe("travel");
  });
});
