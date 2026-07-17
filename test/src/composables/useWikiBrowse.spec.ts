import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createApp, defineComponent } from "vue";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/composables/router";
import { useWikiBrowse, wikiGotoIndex, wikiGotoPage, wikiGotoGraph, wikiGotoLint, wikiRouteSlug, wikiClose } from "../../../src/composables/../../src/composables/useWikiBrowse";

// Install the singleton router into a throwaway app so currentRoute tracks pushes.
beforeAll(async () => {
  createApp(defineComponent({ render: () => null })).use(router);
  await router.isReady();
});

beforeEach(async () => {
  await router.replace("/");
  await flushPromises();
});

describe("useWikiBrowse over the router", () => {
  it("nav helpers push the right paths", async () => {
    wikiGotoIndex();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki");

    wikiGotoPage("alpha");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki/pages/alpha");
    expect(wikiRouteSlug()).toBe("alpha");

    wikiGotoGraph();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki/graph");

    wikiGotoLint();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki/lint");
  });

  it("view computed reflects currentRoute", async () => {
    const { view, isOpen } = useWikiBrowse();
    expect(view.value).toEqual({ mode: "closed" });
    expect(isOpen.value).toBe(false);

    wikiGotoIndex();
    await flushPromises();
    expect(view.value).toEqual({ mode: "index" });
    expect(isOpen.value).toBe(true);

    wikiGotoPage("beta");
    await flushPromises();
    expect(view.value).toEqual({ mode: "page", slug: "beta" });

    wikiGotoGraph();
    await flushPromises();
    expect(view.value).toEqual({ mode: "graph" });

    wikiGotoLint();
    await flushPromises();
    expect(view.value).toEqual({ mode: "lint" });
  });

  it("a [[link]] click (wikiGotoPage) pushes /wiki/pages/:slug", async () => {
    wikiGotoIndex();
    await flushPromises();
    wikiGotoPage("attention-mechanism");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki/pages/attention-mechanism");
    expect(useWikiBrowse().view.value).toEqual({ mode: "page", slug: "attention-mechanism" });
  });

  it("an unsafe slug is coerced to the index rather than pushing a rejectable route", async () => {
    wikiGotoPage("../../etc/passwd");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wiki");
    expect(useWikiBrowse().view.value).toEqual({ mode: "index" });
  });

  it("close returns to chat", async () => {
    wikiGotoPage("alpha");
    await flushPromises();
    wikiClose();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/");
    expect(useWikiBrowse().view.value).toEqual({ mode: "closed" });
  });
});
