import { describe, it, expect } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import {
  heldWhileClosed,
  onOverlayShownAgain,
  provideOverlayVisible,
  useEverOpened,
  useOverlayVisible,
  whileOverlayVisible,
} from "../../../src/composables/overlayVisibility";
import { router } from "../../../src/router/index";
import { roomsViewClose, roomsViewOpen, roomsViewSelect } from "../../../src/composables/useRoomsView";
import { blueprintsViewClose, blueprintsViewMarket, blueprintsViewOpen } from "../../../src/composables/useBlueprintsView";

/** Mounts `child` under a provider whose visibility the test drives. */
function underOverlay(child: () => void) {
  const visible = ref(true);
  const Child = defineComponent({ setup: () => (child(), () => h("i")) });
  const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(Child)) });
  return { visible, wrapper: mount(Host) };
}

describe("heldWhileClosed", () => {
  it("follows the source while open and keeps the last value while closed", () => {
    const open = ref(true);
    const source = ref<string | null>("a");
    const held = heldWhileClosed(open, () => source.value);
    expect(held.value).toBe("a");
    source.value = "b";
    expect(held.value).toBe("b");
    open.value = false;
    source.value = null;
    expect(held.value).toBe("b");
    open.value = true;
    expect(held.value).toBeNull();
  });

  it("starts from the source when created closed", () => {
    expect(heldWhileClosed(ref(false), () => 7).value).toBe(7);
  });
});

describe("useEverOpened", () => {
  it("stays false until the first open and true after it, whatever follows", async () => {
    const open = ref(false);
    const opened = useEverOpened(open);
    expect(opened.value).toBe(false);
    open.value = true;
    await nextTick();
    expect(opened.value).toBe(true);
    open.value = false;
    await nextTick();
    expect(opened.value).toBe(true);
  });
});

describe("visibility under an overlay", () => {
  it("is visible when nothing provides it", () => {
    let seen: boolean | null = null;
    mount(defineComponent({ setup: () => ((seen = useOverlayVisible().value), () => h("i")) }));
    expect(seen).toBe(true);
  });

  it("starts and stops with the visibility, and stops on unmount", async () => {
    const calls: string[] = [];
    const { visible, wrapper } = underOverlay(() =>
      whileOverlayVisible(
        () => calls.push("start"),
        () => calls.push("stop"),
      ),
    );
    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();
    wrapper.unmount();
    expect(calls).toEqual(["start", "stop", "start", "stop"]);
  });

  it("reads again on each re-show, not on the first show", async () => {
    let reads = 0;
    const { visible } = underOverlay(() => onOverlayShownAgain(() => reads++));
    await nextTick();
    expect(reads).toBe(0);
    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();
    expect(reads).toBe(1);
  });
});

// A plain open (the menu, the palette) returns to where the person last was inside the screen, which
// the hidden screen is still showing; an open naming a target goes to the target.
describe("opening again returns to the last place", () => {
  it("rooms: a plain open goes back to the last room, a named one to that room", async () => {
    await router.push("/terminals");
    roomsViewOpen("first");
    await flushPromises();
    roomsViewSelect("second");
    await flushPromises();
    roomsViewClose();
    await flushPromises();
    roomsViewOpen();
    await flushPromises();
    expect(router.currentRoute.value.params.room).toBe("second");
    roomsViewOpen("first");
    await flushPromises();
    expect(router.currentRoute.value.params.room).toBe("first");
    roomsViewClose();
    await flushPromises();
  });

  it("blueprints: a plain open goes back to the market when that is where it was", async () => {
    await router.push("/terminals");
    blueprintsViewOpen();
    await flushPromises();
    blueprintsViewMarket();
    await flushPromises();
    blueprintsViewClose();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("terminals");
    blueprintsViewOpen();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("blueprintMarket");
    blueprintsViewClose();
    await flushPromises();
  });
});
