import { describe, it, expect } from "vitest";
import { mount, DOMWrapper } from "@vue/test-utils";
import CockpitRowMenu from "../../../src/components/CockpitRowMenu.vue";
import type { AttentionAction, MenuPoint } from "../../../src/components/rowMenu";

interface MenuProps {
  canUp: boolean;
  canDown: boolean;
  reorderable: boolean;
  attention: AttentionAction | null;
  parkable: boolean;
  parked: boolean;
  at?: MenuPoint | null;
}
const BASE: MenuProps = { canUp: true, canDown: true, reorderable: true, attention: "unread", parkable: true, parked: false };

// The dropdown is teleported to <body>, so it lives outside the wrapper — query the document.
const PANEL = '[data-testid="cockpit-row-menu-panel"]';
const menuOpen = () => !!document.querySelector(PANEL);
const has = (id: string) => !!document.querySelector(`${PANEL} [data-testid="${id}"]`);
const item = (id: string) => new DOMWrapper(document.querySelector(`[data-testid="${id}"]`) as Element);
const itemIds = () => [...document.querySelectorAll(`${PANEL} [role="menuitem"]`)].map((el) => el.getAttribute("data-testid"));
const mountMenu = (over: Partial<MenuProps & { axis: "vertical" | "horizontal" }> = {}) =>
  mount(CockpitRowMenu, { props: { ...BASE, ...over }, attachTo: document.body });
const kebab = (w: ReturnType<typeof mount>) => w.get('[data-testid="cockpit-row-menu"]');
const openFromKebab = async (over: Partial<MenuProps & { axis: "vertical" | "horizontal" }> = {}) => {
  const w = mountMenu(over);
  await kebab(w).trigger("click");
  return w;
};

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

  // The whole point of the layout (#2299): unread first, close last, never neighbours.
  it("puts mark-unread first and close last, with reorder between them", async () => {
    const w = await openFromKebab();
    expect(itemIds()).toEqual(["row-mark-unread", "reorder-up", "reorder-down", "row-park", "row-close"]);
    w.unmount();
  });

  it("emits move(-1) for up and move(1) for down, then closes", async () => {
    const w = await openFromKebab();
    await item("reorder-up").trigger("click");
    expect(w.emitted("move")?.[0]).toEqual([-1]);
    expect(menuOpen()).toBe(false);

    await kebab(w).trigger("click");
    await item("reorder-down").trigger("click");
    expect(w.emitted("move")?.[1]).toEqual([1]);
    w.unmount();
  });

  it("disables the direction that can't move and does not emit for it", async () => {
    const w = await openFromKebab({ canUp: false });
    expect(item("reorder-up").attributes("disabled")).toBeDefined();
    await item("reorder-up").trigger("click");
    expect(w.emitted("move")).toBeUndefined();
    w.unmount();
  });

  it("leaves the reorder items out outside manual sort", async () => {
    const w = await openFromKebab({ reorderable: false });
    expect(itemIds()).toEqual(["row-mark-unread", "row-park", "row-close"]);
    w.unmount();
  });

  it("marks unread as attention(true) and read as attention(false)", async () => {
    const unread = await openFromKebab({ attention: "unread" });
    await item("row-mark-unread").trigger("click");
    expect(unread.emitted("attention")?.[0]).toEqual([true]);
    expect(menuOpen()).toBe(false);
    unread.unmount();

    const read = await openFromKebab({ attention: "read" });
    expect(has("row-mark-unread")).toBe(false);
    await item("row-mark-read").trigger("click");
    expect(read.emitted("attention")?.[0]).toEqual([false]);
    read.unmount();
  });

  it("offers no attention item when the row has none", async () => {
    const w = await openFromKebab({ attention: null });
    expect(has("row-mark-unread") || has("row-mark-read")).toBe(false);
    w.unmount();
  });

  it("sets aside an awake row and wakes a parked one", async () => {
    const awake = await openFromKebab({ parked: false });
    // The same person-asleep glyph as the cell header's set-aside button (#2406).
    expect(item("row-park").text()).toContain("hotel");
    await item("row-park").trigger("click");
    expect(awake.emitted("park")?.[0]).toEqual([true]);
    awake.unmount();

    const parked = await openFromKebab({ parked: true });
    await item("row-park").trigger("click");
    expect(parked.emitted("park")?.[0]).toEqual([false]);
    parked.unmount();
  });

  it("has no set-aside item for a cell that cannot be set aside, but can always close", async () => {
    const w = await openFromKebab({ parkable: false });
    expect(has("row-park")).toBe(false);
    expect(item("row-close").text()).toContain("power_settings_new");
    await item("row-close").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });

  it("opens at a right-click's point through `at`, and reports when it closes", async () => {
    const w = mountMenu();
    await w.setProps({ at: { top: 40, left: 60 } });
    await w.vm.$nextTick();
    expect(menuOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await w.vm.$nextTick();
    expect(menuOpen()).toBe(false);
    expect(w.emitted("dismissed")).toHaveLength(1);
    w.unmount();
  });

  // A role="menu" is driven from the keyboard (#3257): the first enabled item takes the focus on
  // open, the arrows walk the enabled items and wrap, Home and End jump, Tab closes — and the focus
  // goes back to the ⋮ on close, whichever way it closed.
  it("focuses the first item on open, walks the enabled items with the keys, and gives the focus back on Tab", async () => {
    const w = await openFromKebab({ canUp: false });
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    const focused = () => document.activeElement?.getAttribute("data-testid");
    const press = (key: string) => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    expect(focused()).toBe("row-mark-unread");
    press("ArrowDown");
    expect(focused()).toBe("reorder-down");
    press("End");
    expect(focused()).toBe("row-close");
    press("ArrowDown");
    expect(focused()).toBe("row-mark-unread");
    press("ArrowUp");
    expect(focused()).toBe("row-close");
    press("Home");
    expect(focused()).toBe("row-mark-unread");
    press("Tab");
    await w.vm.$nextTick();
    expect(menuOpen()).toBe(false);
    expect(focused()).toBe("cockpit-row-menu");
    w.unmount();
  });

  it("gives the focus back to the ⋮ on Escape as well", async () => {
    const w = await openFromKebab();
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("row-mark-unread");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await w.vm.$nextTick();
    expect(menuOpen()).toBe(false);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("cockpit-row-menu");
    w.unmount();
  });

  it("closes on an outside pointerdown", async () => {
    const w = await openFromKebab();
    expect(menuOpen()).toBe(true);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await w.vm.$nextTick();
    expect(menuOpen()).toBe(false);
    w.unmount();
  });
});

// A filmstrip runs left to right, so its thumbnails' menu names those directions (same events).
describe("the horizontal axis", () => {
  it("names the moves left and right, and still emits -1 / +1", async () => {
    const w = await openFromKebab({ axis: "horizontal" });
    expect(item("reorder-up").text()).toContain("Move left");
    expect(item("reorder-down").text()).toContain("Move right");
    await item("reorder-up").trigger("click");
    expect(w.emitted("move")).toEqual([[-1]]);
    w.unmount();
  });

  it("keeps up and down for the roster", async () => {
    const w = await openFromKebab();
    expect(item("reorder-up").text()).toContain("Move up");
    w.unmount();
  });
});
