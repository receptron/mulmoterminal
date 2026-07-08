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

    prsGotoIndex(); // re-push /prs while already open — origin must hold
    await settle();

    prsClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });
});
