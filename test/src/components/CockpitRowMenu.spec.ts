import { describe, it, expect } from "vitest";
import { mount, DOMWrapper } from "@vue/test-utils";
import CockpitRowMenu from "../../../src/components/CockpitRowMenu.vue";

// The dropdown is teleported to <body>, so it lives outside the wrapper — query the document.
const menuOpen = () => !!document.querySelector('[data-testid="cockpit-reorder-menu"]');
const item = (id: string) => new DOMWrapper(document.querySelector(`[data-testid="${id}"]`) as Element);
const mountMenu = (canUp = true, canDown = true) => mount(CockpitRowMenu, { props: { canUp, canDown }, attachTo: document.body });
const kebab = (w: ReturnType<typeof mount>) => w.get('[data-testid="cockpit-reorder"]');

describe("CockpitRowMenu", () => {
  it("starts closed and toggles the menu on the ⋮ button", async () => {
    const w = mountMenu();
    expect(menuOpen()).toBe(false);
    await kebab(w).trigger("click");
    expect(menuOpen()).toBe(true);
    await kebab(w).trigger("click");
    expect(menuOpen()).toBe(false);
    w.unmount();
  });

  it("emits move(-1) for up and move(1) for down, then closes", async () => {
    const w = mountMenu();
    await kebab(w).trigger("click");
    await item("reorder-up").trigger("click");
    expect(w.emitted("move")?.[0]).toEqual([-1]);
    expect(menuOpen()).toBe(false); // picking a direction closes the menu

    await kebab(w).trigger("click");
    await item("reorder-down").trigger("click");
    expect(w.emitted("move")?.[1]).toEqual([1]);
    w.unmount();
  });

  it("disables the direction that can't move and does not emit for it", async () => {
    const w = mountMenu(false, true); // at the top: up disabled
    await kebab(w).trigger("click");
    expect(item("reorder-up").attributes("disabled")).toBeDefined();
    await item("reorder-up").trigger("click");
    expect(w.emitted("move")).toBeUndefined();
    w.unmount();
  });

  it("closes on an outside pointerdown", async () => {
    const w = mountMenu();
    await kebab(w).trigger("click");
    expect(menuOpen()).toBe(true);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await w.vm.$nextTick();
    expect(menuOpen()).toBe(false);
    w.unmount();
  });
});
