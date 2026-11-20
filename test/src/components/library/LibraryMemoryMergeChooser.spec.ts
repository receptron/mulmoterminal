// Choosing the memory to merge into (#3331): the arrows move between the choices, Esc goes back.
import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import LibraryMemoryMergeChooser from "../../../../src/components/library/LibraryMemoryMergeChooser.vue";

const choices = ["a", "b", "c"].map((name) => ({ key: `k-${name}`, title: name, file: `${name}.md` }));
const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false });

describe("LibraryMemoryMergeChooser", () => {
  it("focuses the first choice, moves with the arrows held at either end, and picks with a click", async () => {
    const wrapper = mount(LibraryMemoryMergeChooser, { props: { title: "x", choices }, attachTo: document.body, global: { plugins: [i18n] } });
    await flushPromises();
    const focused = () => document.activeElement?.textContent?.trim().slice(0, 1);
    expect(focused()).toBe("a");
    const press = async (key: string) => wrapper.find("[data-testid=memory-merge-chooser]").trigger("keydown", { key });
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowDown");
    expect(focused()).toBe("c");
    await press("ArrowUp");
    expect(focused()).toBe("b");
    await press("Escape");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    await wrapper.findAll("[data-testid=memory-merge-choice]")[1]?.trigger("click");
    expect(wrapper.emitted("pick")).toEqual([["k-b"]]);
    wrapper.unmount();
  });

  it("focuses Cancel when there is nothing to merge into, so Esc is still the chooser's", async () => {
    const wrapper = mount(LibraryMemoryMergeChooser, { props: { title: "x", choices: [] }, attachTo: document.body, global: { plugins: [i18n] } });
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("memory-merge-cancel");
    wrapper.unmount();
  });
});
