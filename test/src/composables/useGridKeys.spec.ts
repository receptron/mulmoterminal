import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useGridKeys, type GridKeys } from "../../../src/composables/useGridKeys";
import { closeCommandPalette, paletteHost, paletteOpen } from "../../../src/composables/commandPalette";

const { runFocusMode, runAppAction } = vi.hoisted(() => ({ runFocusMode: vi.fn(async () => undefined), runAppAction: vi.fn(() => true) }));
vi.mock("../../../src/composables/focusMode", () => ({ runFocusMode }));
vi.mock("../../../src/composables/runAppAction", () => ({ runAppAction }));

// #2266. The grid runs a palette pick through the same gate as a key, and a key bound to
// `command-palette` opens the palette rather than reaching the grid.
const mountKeys = (zoomed: boolean, available = true, filesOpen = false) => {
  const run = vi.fn();
  const holder: { keys: GridKeys | null } = { keys: null };
  const w = mount(
    defineComponent({
      setup() {
        holder.keys = useGridKeys(
          run,
          () => zoomed,
          () => available,
          ref(true),
          () => filesOpen,
        );
        return () => h("div");
      },
    }),
  );
  const keys = holder.keys;
  if (!keys) throw new Error("not mounted");
  return { run, keys, w };
};
const press = (k: string) => new KeyboardEvent("keydown", { key: k, cancelable: true });

afterEach(() => closeCommandPalette());

describe("useGridKeys", () => {
  // The palette disables the Files tab actions from this (#2267).
  it("tells the palette whether the Files pane is up", () => {
    const open = mountKeys(true, true, true);
    expect(paletteHost.value?.filesOpen()).toBe(true);
    open.w.unmount();
    const closed = mountKeys(true, true, false);
    expect(paletteHost.value?.filesOpen()).toBe(false);
    closed.w.unmount();
  });

  it("opens the palette for a key bound to command-palette, and runs nothing on the grid", () => {
    const { run, keys, w } = mountKeys(true);
    keys.onKey({ "command-palette": "F1" }, press("F1"));
    expect(paletteOpen.value).toBe(true);
    expect(run).not.toHaveBeenCalled();
    w.unmount();
  });

  // Full screen is the page's, so focus mode is not a grid shortcut and needs no enlarged terminal (#2580).
  it("runs focus mode for its key and its palette pick, and nothing on the grid", () => {
    runFocusMode.mockClear();
    const { run, keys, w } = mountKeys(false);
    keys.onKey({ "focus-mode": "F11" }, press("F11"));
    paletteHost.value?.run("focus-mode");
    expect(runFocusMode).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
    w.unmount();
  });

  // #2639. A toolbar operation is the app's too: it runs from its key whatever the view, and never
  // reaches the grid's own dispatch.
  it("runs a toolbar operation for its key, and nothing on the grid", () => {
    runAppAction.mockClear();
    const { run, keys, w } = mountKeys(true);
    keys.onKey({ "screen-wiki": "F7" }, press("F7"));
    expect(runAppAction).toHaveBeenCalledWith("screen-wiki");
    expect(run).not.toHaveBeenCalled();
    w.unmount();
  });

  // The app's off-grid handler runs `screen-toggle` and can put the grid in front before the grid's
  // own listener sees the same keydown; taking it again would toggle straight back.
  it("leaves a key another handler already took", () => {
    runAppAction.mockClear();
    const { run, keys, w } = mountKeys(true);
    const taken = press("F8");
    taken.preventDefault();
    keys.onKey({ "screen-toggle": "F8", "zoom-next": "F9" }, taken);
    const takenToo = press("F9");
    takenToo.preventDefault();
    keys.onKey({ "screen-toggle": "F8", "zoom-next": "F9" }, takenToo);
    expect(runAppAction).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    keys.onKey({ "screen-toggle": "F8" }, press("F8"));
    expect(runAppAction).toHaveBeenCalledWith("screen-toggle");
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

  it("refuses a palette pick while the grid is not in front", () => {
    const { run, w } = mountKeys(true, false);
    paletteHost.value?.run("zoom-toggle");
    expect(run).not.toHaveBeenCalled();
    w.unmount();
  });

  it("leaves a key alone, and drops a waiting sequence, while the grid is not in front", () => {
    const { run, keys, w } = mountKeys(true, false);
    const e = press("F1");
    keys.onKey({ "zoom-toggle": "F1" }, e);
    expect(run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    w.unmount();
  });
});
