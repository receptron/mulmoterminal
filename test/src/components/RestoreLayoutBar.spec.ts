import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

const mirror = vi.hoisted(() => ({ restore: vi.fn(), dismiss: vi.fn() }));
const offered = ref<unknown[] | null>(null);
vi.mock("../../../src/composables/gridLayoutMirror", () => ({
  offeredCells: offered,
  restoreOfferedCells: mirror.restore,
  dismissOfferedCells: mirror.dismiss,
}));

const RestoreLayoutBar = (await import("../../../src/components/RestoreLayoutBar.vue")).default;

beforeEach(() => {
  offered.value = null;
  mirror.restore.mockClear();
  mirror.dismiss.mockClear();
});

describe("RestoreLayoutBar", () => {
  it("shows nothing when nothing is offered", () => {
    expect(mount(RestoreLayoutBar).find('[data-testid="grid-restore"]').exists()).toBe(false);
  });

  it("says how many terminals the last layout had, and hands each button to the mirror", async () => {
    offered.value = [{}, {}];
    const w = mount(RestoreLayoutBar);
    expect(w.get('[data-testid="grid-restore"]').text()).toContain("Your last layout had 2 terminals that are not open here.");
    await w.get('[data-testid="grid-restore-go"]').trigger("click");
    await w.get('[data-testid="grid-restore-dismiss"]').trigger("click");
    expect(mirror.restore).toHaveBeenCalledTimes(1);
    expect(mirror.dismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the singular for one", () => {
    offered.value = [{}];
    expect(mount(RestoreLayoutBar).text()).toContain("Your last layout had 1 terminal that is not open here.");
  });
});
