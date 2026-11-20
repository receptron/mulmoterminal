// The Library's `more_horiz` menu (#3327): what closes it.
import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import LibraryMoreMenu from "../../../../src/components/library/LibraryMoreMenu.vue";

const mountMenu = () =>
  mount(
    {
      components: { LibraryMoreMenu },
      template: `<div><LibraryMoreMenu><button role="menuitem" data-testid="item">x</button></LibraryMoreMenu><button data-testid="away">y</button></div>`,
    },
    { attachTo: document.body, global: { mocks: { t: (key: string) => key } } },
  );

describe("LibraryMoreMenu", () => {
  it("closes when focus leaves it for elsewhere on the page, and stays when it moves inside", async () => {
    const wrapper = mountMenu();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await flushPromises();
    const menu = wrapper.find("[role=menu]");
    await menu.trigger("focusout", { relatedTarget: wrapper.find("[data-testid=item]").element });
    expect(wrapper.find("[role=menu]").exists()).toBe(true);
    await menu.trigger("focusout", { relatedTarget: wrapper.find("[data-testid=away]").element });
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    wrapper.unmount();
  });
});
