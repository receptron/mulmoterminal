// #3270. The compact switch saves its own key, a refused save puts it back, and while it is on the
// line-count steppers have nothing to clamp.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import WaitingRowsSection from "../../../../src/components/settings/WaitingRowsSection.vue";
import { i18n } from "../../../../src/i18n";
import { cockpitCompact, setCockpitCompact } from "../../../../src/composables/cockpitCompact";

const server = vi.hoisted(() => ({ ok: true, calls: [] as [string, unknown][] }));
vi.mock("../../../../src/composables/postConfigField", () => ({
  postConfigField: async (field: string, value: unknown) => {
    server.calls.push([field, value]);
    return server.ok ? { ok: true, value } : { ok: false };
  },
}));

afterEach(() => {
  setCockpitCompact(false);
  server.ok = true;
  server.calls.length = 0;
});

const mountSection = () => mount(WaitingRowsSection, { global: { plugins: [i18n] } });
const compactInput = (wrapper: ReturnType<typeof mount>) => wrapper.get<HTMLInputElement>('[data-testid="cockpit-compact"]');
const stepperButtons = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll("button").filter((button) => /line count/.test(button.attributes("aria-label") ?? ""));

describe("WaitingRowsSection — compact rows", () => {
  it("starts off, and saves cockpitCompact alone when switched on", async () => {
    const wrapper = mountSection();
    expect(compactInput(wrapper).element.checked).toBe(false);
    await compactInput(wrapper).setValue(true);
    await flushPromises();
    expect(server.calls).toEqual([["cockpitCompact", true]]);
    expect(cockpitCompact.value).toBe(true);
    wrapper.unmount();
  });

  it("puts the box back when the save is refused", async () => {
    server.ok = false;
    const wrapper = mountSection();
    await compactInput(wrapper).setValue(true);
    await flushPromises();
    expect(compactInput(wrapper).element.checked).toBe(false);
    expect(cockpitCompact.value).toBe(false);
    wrapper.unmount();
  });

  it("disables every line-count stepper while on, and gives them back when off", async () => {
    const wrapper = mountSection();
    const enabledCount = () => stepperButtons(wrapper).filter((button) => button.attributes("disabled") === undefined).length;
    expect(stepperButtons(wrapper)).toHaveLength(6);
    expect(enabledCount()).toBeGreaterThan(0);
    setCockpitCompact(true);
    await flushPromises();
    expect(enabledCount()).toBe(0);
    setCockpitCompact(false);
    await flushPromises();
    expect(enabledCount()).toBeGreaterThan(0);
    wrapper.unmount();
  });
});
