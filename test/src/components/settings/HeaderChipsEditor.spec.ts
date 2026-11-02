// #2622. The header chips edited in Settings: the default set shown when unconfigured, and each
// change sent as one entry naming the chip it means.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { i18n } from "../../../../src/i18n";

const state = vi.hoisted(() => ({
  result: { ok: true, body: {} } as { ok: true; body: object } | { ok: false; problem: string | null; body: null },
  sent: [] as [string, unknown][],
}));
const chips = ref<unknown[] | null>(null);
vi.mock("../../../../src/composables/headerChipsConfig", () => ({
  globalHeaderChips: chips,
  changeHeaderChips: async (action: string, payload: unknown) => {
    state.sent.push([action, payload]);
    return state.result;
  },
}));

const HeaderChipsEditor = (await import("../../../../src/components/settings/HeaderChipsEditor.vue")).default;

afterEach(() => {
  state.result = { ok: true, body: {} };
  state.sent.length = 0;
  chips.value = null;
});

const mountEditor = () => mount(HeaderChipsEditor, { global: { plugins: [i18n] } });
const rows = (wrapper: ReturnType<typeof mountEditor>) => wrapper.findAll('[data-testid="settings-header-chips"] li');

describe("HeaderChipsEditor", () => {
  it("lists the default set when unconfigured, says so, and offers no reset", () => {
    const wrapper = mountEditor();
    expect(wrapper.find('[data-testid="header-chips-default"]').exists()).toBe(true);
    expect(rows(wrapper)).toHaveLength(7);
    expect(wrapper.find('[data-testid="header-chips-reset"]').exists()).toBe(false);
    // Every built-in is already shown, so the menu offers only your own text.
    expect(wrapper.findAll('[data-testid="header-chip-kind"] option')).toHaveLength(1);
  });

  it("sends a custom chip as typed, and a built-in without the text fields", async () => {
    chips.value = ["git"];
    const wrapper = mountEditor();
    await wrapper.find('[data-testid="header-chip-label"] input, input[data-testid="header-chip-label"]').setValue("env");
    await wrapper.find('[data-testid="header-chip-text"] input, input[data-testid="header-chip-text"]').setValue("${branch}");
    await wrapper.find('[data-testid="header-chip-add"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="header-chip-kind"]').setValue("ctx");
    expect(wrapper.find('[data-testid="header-chip-text"]').exists()).toBe(false);
    await wrapper.find('[data-testid="header-chip-add"]').trigger("click");
    await flushPromises();
    expect(state.sent).toEqual([
      ["add", { builtin: "", label: "env", text: "${branch}", when: "" }],
      ["add", { builtin: "ctx", label: "", text: "", when: "" }],
    ]);
  });

  it("names the chip it removes or moves, and cannot move past either end", async () => {
    chips.value = ["git", { label: "env", text: "t" }];
    const wrapper = mountEditor();
    const [first, second] = rows(wrapper);
    const firstButtons = first.findAll("button");
    expect(firstButtons[0].attributes("disabled")).toBeDefined();
    expect(second.findAll("button")[1].attributes("disabled")).toBeDefined();
    await firstButtons[1].trigger("click");
    await flushPromises();
    await second.findAll("button")[2].trigger("click");
    await flushPromises();
    expect(state.sent).toEqual([
      ["move", { index: 0, chip: "git", delta: 1 }],
      ["remove", { index: 1, chip: { label: "env", text: "t" } }],
    ]);
  });

  it("says why a change was refused", async () => {
    chips.value = [];
    state.result = { ok: false, problem: "stale", body: null };
    const wrapper = mountEditor();
    expect(wrapper.find('[data-testid="header-chips-none"]').exists()).toBe(true);
    await wrapper.find('[data-testid="header-chips-reset"]').trigger("click");
    await flushPromises();
    expect(state.sent).toEqual([["reset", {}]]);
    expect(wrapper.find('[data-testid="header-chip-problem"]').text()).toBe(i18n.global.t("headerChips.problems.stale"));
  });
});
