// The Blueprints screen is kept while closed, so its new-build form outlives a close: a start that
// answers after the person closed the screen must not open it again on the new build.
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";

const view = vi.hoisted(() => ({ open: null as { value: boolean } | null, select: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/composables/blueprintsApi")>();
  return {
    ...actual,
    listRuns: async () => ({ ok: true, value: { runs: [] } }),
    listPacks: async () => ({ ok: true, value: { packs: [] } }),
    listPresets: async () => ({ ok: true, value: { presets: [] } }),
  };
});
vi.mock("../../../../src/composables/useBlueprintsView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/composables/useBlueprintsView")>();
  const { computed } = await import("vue");
  return {
    ...actual,
    blueprintsViewSelect: view.select,
    useBlueprintsView: () => ({
      isOpen: computed(() => view.open?.value ?? false),
      runId: computed(() => null),
      inMarket: computed(() => false),
      close: () => undefined,
    }),
  };
});

import BlueprintsOverlay from "../../../../src/components/blueprints/BlueprintsOverlay.vue";
import BlueprintNewBuild from "../../../../src/components/blueprints/BlueprintNewBuild.vue";

describe("a build started from the form", () => {
  it("opens the new build while the screen is up, and not after it was closed", async () => {
    const open = ref(true);
    view.open = open;
    const wrapper = mount(BlueprintsOverlay);
    await flushPromises();
    wrapper.findComponent(BlueprintNewBuild).vm.$emit("started", "run-a");
    expect(view.select).toHaveBeenCalledWith("run-a");
    view.select.mockClear();
    open.value = false;
    await flushPromises();
    wrapper.findComponent(BlueprintNewBuild).vm.$emit("started", "run-b");
    expect(view.select).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
