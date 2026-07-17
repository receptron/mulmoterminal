import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createApp, defineComponent } from "vue";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../src/router";
import {
  useCollectionBrowse,
  browseGotoIndex,
  browseGotoDetail,
  browseNavigateToRecord,
  browseSetSelectedId,
  browseRouteSlug,
  browseRouteSelectedId,
  browseIsFeedRoute,
  browseClose,
} from "./useCollectionBrowse";

// Install the singleton router into a throwaway app so currentRoute tracks pushes.
beforeAll(async () => {
  createApp(defineComponent({ render: () => null })).use(router);
  await router.isReady();
});

beforeEach(async () => {
  await router.replace("/");
  await flushPromises();
  browseSetSelectedId(null);
});

describe("useCollectionBrowse over the router", () => {
  it("browseGotoIndex / browseGotoDetail push the right paths", async () => {
    browseGotoIndex("collection");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections");

    browseGotoIndex("feed");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/feeds");
    expect(browseIsFeedRoute()).toBe(true);

    browseGotoDetail("collection", "todos");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/todos");
    expect(browseRouteSlug()).toBe("todos");
  });

  it("view computed reflects currentRoute", async () => {
    const { view, isOpen } = useCollectionBrowse();
    expect(view.value).toEqual({ mode: "closed" });
    expect(isOpen.value).toBe(false);

    browseGotoIndex("feed");
    await flushPromises();
    expect(view.value).toEqual({ mode: "index", kind: "feed" });
    expect(isOpen.value).toBe(true);

    browseGotoDetail("collection", "todos");
    await flushPromises();
    expect(view.value).toEqual({ mode: "detail", kind: "collection", slug: "todos", selectedId: null });
  });

  it("selectedId is modal-only state and never enters the URL", async () => {
    browseGotoDetail("collection", "todos");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", selectedId: "rec-1" });
    // The record is NOT in the URL — opening it added no history / query.
    expect(router.currentRoute.value.fullPath).toBe("/collections/todos");
  });

  it("a slug change drops the open record (records are not history)", async () => {
    browseGotoDetail("collection", "todos");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Navigating to another collection page leaves the rec-1 modal behind.
    browseGotoDetail("collection", "other");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ slug: "other", selectedId: null });

    browseClose();
    await flushPromises();
    expect(useCollectionBrowse().view.value).toEqual({ mode: "closed" });
    expect(browseRouteSelectedId()).toBeUndefined();
  });

  it("navigateToRecord lands on the detail page with the record deep-linked", async () => {
    browseNavigateToRecord("bar", "rec-2");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/bar");
    expect(browseRouteSelectedId()).toBe("rec-2");
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", kind: "collection", slug: "bar", selectedId: "rec-2" });
  });

  it("navigateToRecord without a recordId on the current page closes any open record", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Re-target the SAME page with no record id — the path doesn't change (so the
    // watcher never fires), but the stale modal must still close, not be reused.
    browseNavigateToRecord("foo");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/foo");
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", slug: "foo", selectedId: null });
  });

  it("does not leak a record across kinds when slugs overlap (collection foo → feed foo)", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Same slug, different kind → the collection's record must NOT bleed into the feed page.
    browseGotoDetail("feed", "foo");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/feeds/foo");
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", kind: "feed", slug: "foo", selectedId: null });
  });

  it("a bare route push (toolbar Chat/Grid) drops the record, so returning can't revive it", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Toolbar Chat / Grid push a bare route WITHOUT calling any browse setter — the
    // sync path watcher must still drop the record on the way out.
    router.push("/");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();

    // Returning to the detail URL by any means (browser Back, a retyped URL) lands
    // here — the record was dropped on leave, so the modal must NOT revive.
    router.push("/collections/foo");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ slug: "foo", selectedId: null });
  });

  it("returning to a page via normal navigation does not revive a stale record modal", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Leave, then come back to the SAME page by a normal (non-record) navigation.
    browseGotoDetail("collection", "bar");
    await flushPromises();
    browseGotoDetail("collection", "foo");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ slug: "foo", selectedId: null });
  });
});
