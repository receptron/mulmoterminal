// The next steps under a finished build, which the kept Blueprints screen keeps mounted while closed:
// the packs they are drawn from are read again when the screen is shown again.
import { describe, it, expect, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const { listPacks } = vi.hoisted(() => ({ listPacks: vi.fn(async () => ({ ok: true, value: { packs: [] } })) }));
vi.mock("../../../../src/composables/blueprintsApi", () => ({ listPacks }));
vi.mock("../../../../src/composables/useBlueprintsView", () => ({ blueprintsViewFollowUp: vi.fn() }));

const BlueprintNextSteps = (await import("../../../../src/components/blueprints/BlueprintNextSteps.vue")).default;

describe("BlueprintNextSteps", () => {
  it("reads the packs again each time the screen is shown", async () => {
    const props = { pair: { base: "docs", usecase: "review" }, projectDir: "/w", answers: {}, changedFiles: [], language: null };
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintNextSteps, props);
    await flushPromises();
    await showAgain();
    expect(listPacks).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
