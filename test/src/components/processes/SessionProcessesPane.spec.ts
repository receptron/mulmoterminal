// The process list polls only while its screen is on screen: the screen is kept while closed, and a
// read still in flight when it is hidden must not queue another.
import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { SessionProcesses } from "../../../../common/sessionProcesses";
import { provideOverlayVisible } from "../../../../src/composables/overlayVisibility";
import { en } from "../../../../src/i18n/en";

const api = vi.hoisted(() => ({ reads: [] as ((list: SessionProcesses[] | null) => void)[] }));
vi.mock("../../../../src/composables/processesApi", () => ({
  loadSessionProcesses: () => new Promise((resolve) => api.reads.push(resolve)),
  killProcess: async () => "ended",
}));

const SessionProcessesPane = (await import("../../../../src/components/processes/SessionProcessesPane.vue")).default;
const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });

afterEach(() => {
  api.reads.length = 0;
  vi.useRealTimers();
});

describe("SessionProcessesPane", () => {
  it("reads nothing more once hidden, even for a tick that came during a slow read, and reads on showing", async () => {
    vi.useFakeTimers();
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(SessionProcessesPane)) });
    const wrapper = mount(Host, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(api.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000); // a tick while the first read is still out
    visible.value = false;
    await flushPromises();
    api.reads[0]?.([]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.reads).toHaveLength(1);
    visible.value = true;
    await flushPromises();
    expect(api.reads).toHaveLength(2);
    wrapper.unmount();
  });
});
