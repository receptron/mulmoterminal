// Mounts a component inside a kept full-screen screen whose visibility the test drives, for the
// children that must read again when the screen is shown again.
import { defineComponent, h, ref, type Component } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { provideOverlayVisible } from "../../../src/composables/overlayVisibility";

export function mountUnderOverlay(component: Component, props: Record<string, unknown>, options: { attachTo?: HTMLElement } = {}) {
  const visible = ref(true);
  const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(component, props)) });
  const wrapper = mount(Host, options);
  /** Hides the screen and shows it again, letting every read settle. */
  const showAgain = async (): Promise<void> => {
    visible.value = false;
    await flushPromises();
    visible.value = true;
    await flushPromises();
  };
  return { wrapper, visible, showAgain };
}
