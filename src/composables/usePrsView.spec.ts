import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../router";
import { prsGotoIndex, prsClose } from "./usePrsView";

// Drives the real singleton router (jsdom web-history) — the composables are bound to
// it. Each test starts from chat, then navigates to the origin under test.
const settle = () => flushPromises();

describe("usePrsView return-to-origin", () => {
  beforeEach(async () => {
    await router.push("/");
    await settle();
  });

  it("returns to the grid when the PR view was opened from the grid", async () => {
    await router.push("/terminals");
    await settle();

    prsGotoIndex();
    await settle();
    expect(router.currentRoute.value.name).toBe("prs");

    prsClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("returns to chat when the PR view was opened from the single view", async () => {
    prsGotoIndex();
    await settle();
    expect(router.currentRoute.value.name).toBe("prs");

    prsClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });

  it("keeps the grid origin when re-opened while already in the PR view", async () => {
    await router.push("/terminals");
    await settle();
    prsGotoIndex();
    await settle();

    prsGotoIndex(); // re-push /prs while already open — origin must ride along
    await settle();

    prsClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  // Regression (codex #273): the origin rides the history entry, so a /prs reached
  // WITHOUT prsGotoIndex (browser back/forward, direct load) must fall back to chat —
  // never a stale origin captured by an earlier open.
  it("falls back to chat for a history-driven /prs, ignoring an earlier open's origin", async () => {
    await router.push("/terminals");
    await settle();
    prsGotoIndex(); // captures /terminals into that entry's state
    await settle();

    await router.push("/");
    await settle();
    await router.push("/prs"); // fresh /prs entry, no captured origin
    await settle();

    prsClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });
});
