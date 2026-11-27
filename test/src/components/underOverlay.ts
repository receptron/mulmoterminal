// Mounts a component inside a kept full-screen screen whose visibility the test drives, for the
// children that must read again when the screen is shown again.
import { defineComponent, h, ref, type Component } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { provideOverlayVisible } from "../../../src/composables/overlayVisibility";

type Props = Record<string, unknown>;

/** `props` may be a getter, read in the host's render, for a test that changes them while mounted. */
export function mountUnderOverlay(component: Component, props: Props | (() => Props), options: { attachTo?: HTMLElement } = {}) {
  const visible = ref(true);
  const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(component, typeof props === "function" ? props() : props)) });
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
