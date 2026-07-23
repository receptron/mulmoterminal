import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CockpitRowMenu from "../../../src/components/CockpitRowMenu.vue";

const mountMenu = (canUp = true, canDown = true) => mount(CockpitRowMenu, { props: { canUp, canDown }, attachTo: document.body });

const kebab = (w: ReturnType<typeof mount>) => w.get('[data-testid="cockpit-reorder"]');
const menu = (w: ReturnType<typeof mount>) => w.find('[data-testid="cockpit-reorder-menu"]');

describe("CockpitRowMenu", () => {
  it("starts closed and toggles the menu on the ⋮ button", async () => {
    const w = mountMenu();
    expect(menu(w).exists()).toBe(false);
    await kebab(w).trigger("click");
    expect(menu(w).exists()).toBe(true);
    await kebab(w).trigger("click");
    expect(menu(w).exists()).toBe(false);
  });

  it("emits move(-1) for up and move(1) for down, then closes", async () => {
    const w = mountMenu();
    await kebab(w).trigger("click");
    await w.get('[data-testid="reorder-up"]').trigger("click");
    expect(w.emitted("move")?.[0]).toEqual([-1]);
    expect(menu(w).exists()).toBe(false); // picking a direction closes the menu

    await kebab(w).trigger("click");
    await w.get('[data-testid="reorder-down"]').trigger("click");
    expect(w.emitted("move")?.[1]).toEqual([1]);
  });

  it("disables the direction that can't move and does not emit for it", async () => {
    const w = mountMenu(false, true); // at the top: up disabled
    await kebab(w).trigger("click");
    expect(w.get('[data-testid="reorder-up"]').attributes("disabled")).toBeDefined();
    await w.get('[data-testid="reorder-up"]').trigger("click");
    expect(w.emitted("move")).toBeUndefined();
  });

  it("closes on an outside pointerdown", async () => {
    const w = mountMenu();
    await kebab(w).trigger("click");
    expect(menu(w).exists()).toBe(true);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await w.vm.$nextTick();
    expect(menu(w).exists()).toBe(false);
    w.unmount();
  });
});
