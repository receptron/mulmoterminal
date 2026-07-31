import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import { prsGotoIndex, prsClose } from "../../../src/composables/usePrsView";
import { accountingViewOpen, accountingViewClose } from "../../../src/composables/useAccountingView";
import { wikiGotoIndex, wikiGotoPage, wikiGotoGraph, wikiClose } from "../../../src/composables/useWikiBrowse";
import { browseGotoIndex, browseGotoDetail, browseClose } from "../../../src/composables/useCollectionBrowse";
import { viewIsGrid } from "../../../src/composables/overlayOrigin";

// Drives the real singleton router (jsdom web-history) — the composables are bound to it.
const settle = () => flushPromises();

// Every full-screen overlay, as (name, open, close). Same contract for all of them, so the
// cases below are one table rather than four near-identical blocks (#886).
const OVERLAYS = [
  ["PRs", () => prsGotoIndex(), () => prsClose(), "prs"],
  ["accounting", () => accountingViewOpen(), () => accountingViewClose(), "accounting"],
  ["wiki", () => wikiGotoIndex(), () => wikiClose(), "wiki"],
  ["collections", () => browseGotoIndex("collection"), () => browseClose(), "collections"],
] as const;

describe("overlay return-to-origin", () => {
  beforeEach(async () => {
    await router.push({ name: "chat" });
    await settle();
  });

  it.each(OVERLAYS)("%s: opened from the grid, closes back to the grid", async (_name, open, close, routeName) => {
    await router.push("/terminals");
    await settle();

    open();
    await settle();
    expect(router.currentRoute.value.name).toBe(routeName);

    close();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it.each(OVERLAYS)("%s: opened from the single view, closes back to it", async (_name, open, close, routeName) => {
    open();
    await settle();
    expect(router.currentRoute.value.name).toBe(routeName);

    close();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });

  // A direct load / a history-driven entry carries no origin.
  //
  // The fallback is the GRID (#1190). It used to be chat, on the reasoning that resolving by name
  // rather than the literal "/" avoided landing on the grid (#883) — and that reasoning inverted
  // once the grid became the view the single one is being replaced by. It is also where "/" itself
  // sends a fresh load, and it now decides what renders BEHIND an origin-less overlay: pointing it
  // at chat would put the single view back on screen under one opened from a link.
  it.each(OVERLAYS)("%s: falls back to the grid when the entry carries no origin", async (_name, _open, close, routeName) => {
    await router.push(`/${routeName === "collections" ? "collections" : routeName}`);
    await settle();

    close();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  // Moving around INSIDE an overlay must not re-record the origin as the overlay itself,
  // or closing from a sub-page would return to the page you just left.
  it("wiki: keeps the origin across its own tabs", async () => {
    await router.push("/terminals");
    await settle();

    wikiGotoIndex();
    await settle();
    wikiGotoPage("alpha");
    await settle();
    wikiGotoGraph();
    await settle();
    expect(router.currentRoute.value.name).toBe("wikiGraph");

    wikiClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("collections: keeps the origin from index to detail", async () => {
    await router.push("/terminals");
    await settle();

    browseGotoIndex("collection");
    await settle();
    browseGotoDetail("collection", "todos");
    await settle();
    expect(router.currentRoute.value.name).toBe("collectionDetail");

    browseClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  // Hopping straight from one overlay to another (grid → PRs → Worklog) must keep the view
  // UNDERNEATH as the return target. Recording the previous overlay instead is what made the
  // header follow Worklog back to the single view (#892) — and only a real click-through
  // found it, because every earlier case opened exactly one overlay.
  it("carries the underlying view across an overlay-to-overlay hop", async () => {
    await router.push("/terminals");
    await settle();

    prsGotoIndex();
    await settle();
    wikiGotoIndex();
    await settle();
    expect(router.currentRoute.value.name).toBe("wiki");

    wikiClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("carries the single view across an overlay-to-overlay hop", async () => {
    browseGotoIndex("collection");
    await settle();
    accountingViewOpen();
    await settle();

    accountingViewClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });
});

// Which SHELL renders under whatever is on screen. Previously only the toolbar asked this; since
// #1190 App.vue binds to it too, so a wrong answer is not a mismatched button — it is the wrong
// view mounted behind an overlay, and after the single view goes, no view at all.
describe("viewIsGrid — the shell underneath", () => {
  beforeEach(async () => {
    await router.push({ name: "chat" });
    await settle();
  });

  it("is the grid on /terminals, and not on /chat", async () => {
    await router.push("/terminals");
    await settle();
    expect(viewIsGrid.value).toBe(true);

    await router.push({ name: "chat" });
    await settle();
    expect(viewIsGrid.value).toBe(false);
  });

  it.each(OVERLAYS)("%s: keeps the grid underneath when opened FROM the grid", async (_name, open) => {
    // THE case. The header stays on screen above an overlay, so the shell behind it must not
    // change: swapping in the single view would take away the very button that was clicked, and
    // mount a terminal nobody asked for behind the overlay.
    await router.push("/terminals");
    await settle();

    open();
    await settle();
    expect(viewIsGrid.value).toBe(true);
  });

  it.each(OVERLAYS)("%s: keeps the single view underneath when opened from it", async (_name, open) => {
    // The mirror, and the reason this follows the ORIGIN rather than just "not chat": while the
    // single view still exists, an overlay opened from it must not swap the grid in behind.
    open();
    await settle();
    expect(viewIsGrid.value).toBe(false);
  });

  it("answers the grid for an overlay with no recorded origin", async () => {
    // A direct load or a link: nothing to return to, so the fallback decides — and it is the grid.
    await router.push("/prs");
    await settle();
    expect(viewIsGrid.value).toBe(true);
  });

  it("carries the origin across a hop from one overlay to another", async () => {
    // grid → PRs → collections. The shell must not flip halfway through a chain of overlays.
    await router.push("/terminals");
    await settle();
    prsGotoIndex();
    await settle();
    browseGotoIndex("collection");
    await settle();
    expect(viewIsGrid.value).toBe(true);
  });
});
