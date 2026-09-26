import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CommandPalette from "../../../src/components/CommandPalette.vue";
import { closeCommandPalette, openCommandPalette, paletteOpen, providePaletteHost } from "../../../src/composables/commandPalette";
import { setActiveKeymap } from "../../../src/composables/activeKeymap";

// #2266. The palette runs what is picked through the grid's host, and nothing that cannot run.
let withdraw: () => void = () => {};
const host = (zoomed: boolean) => {
  const run = vi.fn();
  withdraw = providePaletteHost({ run, zoomed: () => zoomed });
  return run;
};

const mountPalette = async () => {
  openCommandPalette();
  const w = mount(CommandPalette, { attachTo: document.body });
  await flushPromises();
  return w;
};
const panel = () => document.querySelector<HTMLElement>('[data-testid="command-palette"]');
const input = () => document.querySelector<HTMLInputElement>('[data-testid="command-palette-input"]');
const key = async (k: string) => {
  panel()?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  await flushPromises();
};
const type = async (text: string) => {
  const el = input();
  if (!el) throw new Error("no input");
  el.value = text;
  el.dispatchEvent(new Event("input"));
  await flushPromises();
};

afterEach(() => {
  withdraw();
  closeCommandPalette();
  setActiveKeymap(null);
  document.body.innerHTML = "";
});

describe("CommandPalette", () => {
  it("narrows to what is typed and runs it on Enter, closing itself", async () => {
    const run = host(true);
    const w = await mountPalette();
    await type("find");
    await key("Enter");
    expect(run).toHaveBeenCalledWith("files-find");
    expect(paletteOpen.value).toBe(false);
    w.unmount();
  });

  it("does not run an action the view cannot run, and stays open", async () => {
    const run = host(false);
    const w = await mountPalette();
    await type("find");
    await key("Enter");
    expect(run).not.toHaveBeenCalled();
    expect(paletteOpen.value).toBe(true);
    expect(document.body.textContent).toContain("Needs an enlarged terminal");
    w.unmount();
  });

  it("shows the key an action is bound to", async () => {
    host(true);
    setActiveKeymap({ "files-find": "Cmd+k p" });
    const w = await mountPalette();
    const row = document.querySelector('[data-action="files-find"]');
    expect(row?.textContent).toContain("Cmd+k p");
    w.unmount();
  });

  it("moves the selection with the arrows", async () => {
    const run = host(true);
    const w = await mountPalette();
    await key("ArrowDown");
    await key("Enter");
    const second = document.querySelectorAll('[data-testid="command-palette-row"]')[1]?.getAttribute("data-action");
    expect(run).toHaveBeenCalledWith(second);
    w.unmount();
  });

  it("closes on Escape without running anything", async () => {
    const run = host(true);
    const w = await mountPalette();
    await key("Escape");
    expect(paletteOpen.value).toBe(false);
    expect(run).not.toHaveBeenCalled();
    w.unmount();
  });

  it("puts the cursor in the search box", async () => {
    host(true);
    const w = await mountPalette();
    expect(document.activeElement).toBe(input());
    w.unmount();
  });
});
