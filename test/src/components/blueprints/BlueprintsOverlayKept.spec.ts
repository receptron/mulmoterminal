// The Blueprints screen is kept while closed, so what it started before a close can answer after it:
// a build start must not open the screen again, and an old list must not replace a newer one.
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";

const view = vi.hoisted(() => ({ open: null as { value: boolean } | null, select: vi.fn() }));
const api = vi.hoisted(() => ({ lists: [] as ((ids: string[]) => void)[] }));
vi.mock("../../../../src/composables/blueprintsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/composables/blueprintsApi")>();
  return {
    ...actual,
    listRuns: () =>
      new Promise((resolve) =>
        api.lists.push((ids) =>
          resolve({
            ok: true,
            value: {
              runs: ids.map((id) => ({
                id,
                projectDir: `/w/${id}`,
                createdAtMs: 1,
                current: null,
                waitingOn: null,
                archived: false,
                passed: 1,
                total: 1,
                usecaseTitle: null,
              })),
            },
          }),
        ),
      ),
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
    api.lists.splice(0).forEach((answer) => answer([]));
    wrapper.findComponent(BlueprintNewBuild).vm.$emit("started", "run-a");
    expect(view.select).toHaveBeenCalledWith("run-a");
    view.select.mockClear();
    open.value = false;
    await flushPromises();
    wrapper.findComponent(BlueprintNewBuild).vm.$emit("started", "run-b");
    expect(view.select).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps the newer list when an earlier opening's read answers last", async () => {
    const open = ref(true);
    view.open = open;
    const wrapper = mount(BlueprintsOverlay);
    await flushPromises();
    const early = api.lists.splice(0);
    open.value = false;
    await flushPromises();
    open.value = true;
    await flushPromises();
    api.lists.splice(0).forEach((answer) => answer(["fresh"]));
    await flushPromises();
    early.forEach((answer) => answer(["stale"]));
    await flushPromises();
    expect(wrapper.findAll('[data-testid="blueprint-run-item"]').map((item) => item.text().includes("fresh"))).toEqual([true]);
    wrapper.unmount();
  });
});
