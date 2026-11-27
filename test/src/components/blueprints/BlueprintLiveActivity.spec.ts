// The Blueprints screen is kept while closed: the live tool calls let go of their channel while it is
// hidden, and follow the session again when it is shown.
import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { provideOverlayVisible } from "../../../../src/composables/overlayVisibility";

const feed = vi.hoisted(() => ({ sessionId: null as (() => string | null) | null }));
vi.mock("../../../../src/composables/useToolCallFeed", () => ({
  useToolCallFeed: (_calls: unknown, sessionId: () => string | null) => {
    feed.sessionId = sessionId;
  },
}));

const BlueprintLiveActivity = (await import("../../../../src/components/blueprints/BlueprintLiveActivity.vue")).default;

describe("BlueprintLiveActivity", () => {
  it("follows the session only while the screen is shown", async () => {
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(BlueprintLiveActivity, { sessionId: "s-1" })) });
    const wrapper = mount(Host);
    expect(feed.sessionId?.()).toBe("s-1");
    visible.value = false;
    await nextTick();
    expect(feed.sessionId?.()).toBeNull();
    visible.value = true;
    await nextTick();
    expect(feed.sessionId?.()).toBe("s-1");
    wrapper.unmount();
  });
});
