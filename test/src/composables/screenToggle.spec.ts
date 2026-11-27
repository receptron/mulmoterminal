import { describe, it, expect } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import { toggleLastScreen } from "../../../src/composables/screenToggle";
import { libraryViewOpen } from "../../../src/composables/useLibraryView";
import { overlayOriginState } from "../../../src/composables/overlayOrigin";

const here = () => router.currentRoute.value;

describe("toggleLastScreen", () => {
  it("does nothing before any screen was opened", async () => {
    await router.push("/terminals");
    expect(toggleLastScreen()).toBe(false);
    expect(here().name).toBe("terminals");
  });

  it("leaves a screen for where it was opened from, and goes back to it, query and all", async () => {
    await router.push("/terminals");
    libraryViewOpen({ session: "s1", cwd: "/work" });
    await flushPromises();
    expect(toggleLastScreen()).toBe(true);
    await flushPromises();
    expect(here().name).toBe("terminals");
    expect(toggleLastScreen()).toBe(true);
    await flushPromises();
    expect(here().name).toBe("library");
    expect(here().query).toEqual({ session: "s1", cwd: "/work" });
    // and leaving again still knows where it came from
    expect(toggleLastScreen()).toBe(true);
    await flushPromises();
    expect(here().name).toBe("terminals");
  });

  it("goes back to the most recent of several screens", async () => {
    await router.push("/terminals");
    await router.push({ name: "skills", state: overlayOriginState() });
    await router.push({ name: "usage", hash: "#weeks", state: overlayOriginState() });
    await router.push("/terminals");
    expect(toggleLastScreen()).toBe(true);
    await flushPromises();
    expect(here().name).toBe("usage");
    expect(here().hash).toBe("#weeks");
    toggleLastScreen();
    await flushPromises();
  });
});
