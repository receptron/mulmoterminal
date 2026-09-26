import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useGridKeys, type GridKeys } from "../../../src/composables/useGridKeys";
import { closeCommandPalette, paletteHost, paletteOpen } from "../../../src/composables/commandPalette";

// #2266. The grid runs a palette pick through the same gate as a key, and a key bound to
// `command-palette` opens the palette rather than reaching the grid.
const mountKeys = (zoomed: boolean) => {
  const run = vi.fn();
  const holder: { keys: GridKeys | null } = { keys: null };
  const w = mount(
    defineComponent({
      setup() {
        holder.keys = useGridKeys(run, () => zoomed);
        return () => h("div");
      },
    }),
  );
  const keys = holder.keys;
  if (!keys) throw new Error("not mounted");
  return { run, keys, w };
};
const press = (k: string) => ({
  type: "keydown",
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

afterEach(() => closeCommandPalette());

describe("useGridKeys", () => {
  it("opens the palette for a key bound to command-palette, and runs nothing on the grid", () => {
    const { run, keys, w } = mountKeys(true);
    keys.onKey({ "command-palette": "F1" }, press("F1"));
    expect(paletteOpen.value).toBe(true);
    expect(run).not.toHaveBeenCalled();
    w.unmount();
  });

  it("runs a palette pick through the view-state gate", () => {
    const { run, w } = mountKeys(false);
    paletteHost.value?.run("files-find"); // needs an enlarged terminal
    expect(run).not.toHaveBeenCalled();
    paletteHost.value?.run("zoom-toggle");
    expect(run).toHaveBeenCalledWith("zoom-toggle");
    w.unmount();
  });

  it("is the palette's host while mounted, and not after", () => {
    const { w } = mountKeys(true);
    expect(paletteHost.value).not.toBeNull();
    w.unmount();
    expect(paletteHost.value).toBeNull();
  });
});
