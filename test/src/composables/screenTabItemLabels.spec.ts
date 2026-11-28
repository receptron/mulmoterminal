import { describe, it, expect } from "vitest";
import {
  finishedReading,
  labelIn,
  listKeyOf,
  owedAnotherRead,
  parseItemList,
  planReads,
  startedReading,
  type ItemList,
} from "../../../src/composables/screenTabItemLabels";
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
const index = tabAt("collections", {});
const answered = (slugs: string[], reading = false, again = false): ItemList => ({
  labels: Object.fromEntries(slugs.map((slug) => [slug, { title: slug.toUpperCase(), icon: "star" }])),
  reading,
  again,
});
const unanswered = (reading = false, again = false): ItemList => ({ labels: null, reading, again });
const workspace = listKeyOf("collections", { slug: "x", project: null });
const inP1 = listKeyOf("collections", { slug: "x", project: "p1" });
const feeds = listKeyOf("feeds", { slug: "x", project: null });
const request = (listKey: string, screen: "collections" | "feeds", project: string | null = null) => ({ listKey, screen, project });

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

  it("skips malformed entries, and is null for a body that is not the list", () => {
    const body = { feeds: [null, 7, "hn", { slug: 1, title: "x" }, { slug: "a" }, { title: "b" }, { slug: "ok", title: "OK", icon: 3 }] };
    expect(parseItemList(body, "feeds")).toEqual({ ok: { title: "OK", icon: "" } });
    expect(parseItemList({ feeds: [] }, "feeds")).toEqual({});
    [null, undefined, "x", [], {}, { feeds: {} }, { feeds: null }, { collections: [{ slug: "a", title: "A" }] }].forEach((other) =>
      expect(parseItemList(other, "feeds"), JSON.stringify(other)).toBeNull(),
    );
  });
});

describe("planReads", () => {
  it("reads every list that never answered, once per screen and project, with its project", () => {
    expect(planReads([index, art, travel, artInP1, hn], {}, null)).toEqual({
      read: [request(workspace, "collections"), request(inP1, "collections", "p1"), request(feeds, "feeds")],
      owed: [],
    });
    expect(planReads([art], { [workspace]: unanswered() }, null).read).toEqual([request(workspace, "collections")]);
  });

  it("reads an answered list again only for the visit that shows one of its tabs", () => {
    const lists = { [workspace]: answered(["art"]), [feeds]: answered(["hn"]) };
    expect(planReads([art, travel, hn], lists, null)).toEqual({ read: [], owed: [] });
    expect(planReads([art, travel, hn], lists, "collections")).toEqual({ read: [], owed: [] });
    expect(planReads([art, travel, hn], lists, travel.key)).toEqual({ read: [request(workspace, "collections")], owed: [] });
  });

  it("owes a list one more read instead of reading it twice at once", () => {
    expect(planReads([art], { [workspace]: answered(["art"], true) }, art.key)).toEqual({ read: [], owed: [workspace] });
    expect(planReads([art], { [workspace]: unanswered(true) }, null)).toEqual({ read: [], owed: [workspace] });
    expect(planReads([art], { [workspace]: answered(["art"], true) }, null)).toEqual({ read: [], owed: [] });
  });

  it("reads nothing for tabs that are not collection or feed items", () => {
    const tabs = ["collections", "feeds", "roomView", "blueprintRun", "wikiPage", "skills"].map((name) => tabAt(name, { room: "r", run: "b", slug: "s" }));
    expect(planReads(tabs, {}, tabs[0]?.key ?? null)).toEqual({ read: [], owed: [] });
  });
});

describe("reading a list", () => {
  it("replaces the last answer with the new one, so a renamed or deleted entry does not linger", () => {
    const next = finishedReading(startedReading(answered(["art", "gone"])), { art: { title: "Paintings", icon: "brush" } });
    expect(next).toEqual({ labels: { art: { title: "Paintings", icon: "brush" } }, reading: false, again: false });
  });

  it("keeps the last answer when a read fails", () => {
    expect(finishedReading(startedReading(answered(["art"])), null)).toEqual(answered(["art"]));
    expect(finishedReading(startedReading(undefined), null)).toEqual(unanswered());
    expect(finishedReading(undefined, null)).toEqual(unanswered());
  });

  it("carries a read owed during the read to its end, and a new read starts owing nothing", () => {
    const owed = owedAnotherRead(startedReading(answered(["art"])));
    expect(owed).toEqual(answered(["art"], true, true));
    expect(finishedReading(owed, {}).again).toBe(true);
    expect(startedReading(finishedReading(owed, {}))).toEqual({ labels: {}, reading: true, again: false });
  });
});

describe("labelIn", () => {
  it("is the answer's own entry for a slug, and null before an answer or for a slug it does not name", () => {
    expect(labelIn(answered(["art"]), "art")).toEqual({ title: "ART", icon: "star" });
    expect(labelIn(answered(["art"]), "travel")).toBeNull();
    expect(labelIn(unanswered(), "art")).toBeNull();
    expect(labelIn(undefined, "art")).toBeNull();
  });

  it("does not read the prototype for a slug named like one of its members", () => {
    ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"].forEach((slug) => expect(labelIn(answered(["art"]), slug), slug).toBeNull());
    const own = parseItemList({ collections: [{ slug: "constructor", title: "Builders" }] }, "collections");
    expect(labelIn({ labels: own, reading: false, again: false }, "constructor")).toEqual({ title: "Builders", icon: "" });
  });
});
