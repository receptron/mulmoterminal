import { describe, it, expect } from "vitest";
import { listKeyOf, listsToRead, parseItemList, type ItemList } from "../../../src/composables/screenTabItemLabels";
import { tabOfRoute, type ScreenTab } from "../../../src/composables/screenTabsModel";

const tabAt = (name: string, params: Record<string, unknown>, query: Record<string, unknown> = {}): ScreenTab => {
  const target = tabOfRoute({ name, params, query });
  if (target === null) throw new Error(name);
  return { ...target, path: "/" };
};
const art = tabAt("collectionDetail", { slug: "art" });
const travel = tabAt("collectionDetail", { slug: "travel" });
const artInP1 = tabAt("collectionDetail", { slug: "art" }, { project: "p1" });
const hn = tabAt("feedDetail", { slug: "hn" });
const list = (labels: string[], lookedFor: string[], reading = false): ItemList => ({
  labels: Object.fromEntries(labels.map((slug) => [slug, { title: slug.toUpperCase(), icon: "star" }])),
  lookedFor: new Set(lookedFor),
  reading,
});
const workspaceCollections = listKeyOf("collections", { slug: "x", project: null });

describe("parseItemList", () => {
  it("reads each entry's title and icon by slug from the named field", () => {
    const body = {
      collections: [
        { slug: "art", title: "Art", icon: "palette", source: "x" },
        { slug: "trip", title: "Trip" },
      ],
    };
    expect(parseItemList(body, "collections")).toEqual({ art: { title: "Art", icon: "palette" }, trip: { title: "Trip", icon: "" } });
  });

  it("skips malformed entries and reads nothing from a body that is not the list", () => {
    const body = { feeds: [null, 7, "hn", { slug: 1, title: "x" }, { slug: "a" }, { title: "b" }, { slug: "ok", title: "OK", icon: 3 }] };
    expect(parseItemList(body, "feeds")).toEqual({ ok: { title: "OK", icon: "" } });
    [null, undefined, "x", [], {}, { feeds: {} }, { collections: [{ slug: "a", title: "A" }] }].forEach((other) =>
      expect(parseItemList(other, "feeds"), JSON.stringify(other)).toEqual({}),
    );
  });
});

describe("listsToRead", () => {
  it("reads one list per screen and project, for every slug the tabs name", () => {
    const index: ScreenTab = { ...tabAt("collections", {}), path: "/collections" };
    expect(listsToRead([index, art, travel, artInP1, hn], {})).toEqual([
      { listKey: workspaceCollections, screen: "collections", project: null, slugs: ["art", "travel"] },
      { listKey: listKeyOf("collections", { slug: "x", project: "p1" }), screen: "collections", project: "p1", slugs: ["art"] },
      { listKey: listKeyOf("feeds", { slug: "x", project: null }), screen: "feeds", project: null, slugs: ["hn"] },
    ]);
  });

  it("reads nothing for named slugs, slugs already looked for, or a list being read", () => {
    expect(listsToRead([art, travel], { [workspaceCollections]: list(["art", "travel"], ["art"]) })).toEqual([]);
    expect(listsToRead([art, travel], { [workspaceCollections]: list([], ["art", "travel"]) })).toEqual([]);
    expect(listsToRead([art], { [workspaceCollections]: list([], [], true) })).toEqual([]);
  });

  it("reads a list again for a slug it has not looked for yet", () => {
    expect(listsToRead([art, travel], { [workspaceCollections]: list(["art"], ["art"]) })).toEqual([
      { listKey: workspaceCollections, screen: "collections", project: null, slugs: ["travel"] },
    ]);
  });

  it("reads nothing for tabs that are not items", () => {
    const tabs = ["collections", "feeds", "roomView", "skills"].map((name) => tabAt(name, { room: "r" }));
    expect(listsToRead(tabs, {})).toEqual([]);
  });
});
