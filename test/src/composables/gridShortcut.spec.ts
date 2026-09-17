import { describe, it, expect } from "vitest";
import { gridShortcutFor, isEditableTarget, type ShortcutKeyEvent } from "../../../src/composables/gridShortcut.js";
import type { Keymap } from "../../../common/keymap.js";

const KEYMAP: Keymap = { "zoom-next": "PageDown", "zoom-prev": "PageUp" };

const key = (over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  type: "keydown",
  key: "PageDown",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe("gridShortcutFor", () => {
  it("resolves the user's bindings while zoomed", () => {
    expect(gridShortcutFor(KEYMAP, key({ key: "PageDown" }), true)).toBe("zoom-next");
    expect(gridShortcutFor(KEYMAP, key({ key: "PageUp" }), true)).toBe("zoom-prev");
  });

  it("does nothing with an EMPTY keymap — shortcuts are opt-in via config.json", () => {
    expect(gridShortcutFor({}, key({ key: "PageDown" }), true)).toBeNull();
    expect(gridShortcutFor({}, key({ key: "PageUp" }), true)).toBeNull();
  });

  it("does nothing when nothing is zoomed — an un-zoomed grid has no selected terminal", () => {
    expect(gridShortcutFor(KEYMAP, key({ key: "PageDown" }), false)).toBeNull();
    expect(gridShortcutFor(KEYMAP, key({ key: "PageUp" }), false)).toBeNull();
  });

  it("gates the actions that need a subject terminal on being zoomed", () => {
    const map: Keymap = { "terminal-new-adjacent": "F2", "terminal-close": "F3", "terminal-restart": "F4" };
    expect(gridShortcutFor(map, key({ key: "F2" }), true)).toBe("terminal-new-adjacent");
    expect(gridShortcutFor(map, key({ key: "F3" }), true)).toBe("terminal-close");
    // Restarting acts on one running agent, so it needs a terminal the grid can name (#1918).
    expect(gridShortcutFor(map, key({ key: "F4" }), true)).toBe("terminal-restart");
    expect(gridShortcutFor(map, key({ key: "F2" }), false)).toBeNull();
    expect(gridShortcutFor(map, key({ key: "F3" }), false)).toBeNull();
    expect(gridShortcutFor(map, key({ key: "F4" }), false)).toBeNull();
  });

  // The Files pane exists only in the ENLARGED row (docs/grid-view-modes.md), so a tiled grid has
  // nowhere to put the finder and the key declines rather than guessing which cell was meant.
  it("gates the file finder on a zoom too, because the pane it opens lives in the zoomed row", () => {
    const map: Keymap = { "files-find": "F5" };
    expect(gridShortcutFor(map, key({ key: "F5" }), true)).toBe("files-find");
    expect(gridShortcutFor(map, key({ key: "F5" }), false)).toBeNull();
  });

  it("lets terminal-new work WITHOUT a zoom — appending a cell needs no subject", () => {
    const map: Keymap = { "terminal-new": "F1" };
    expect(gridShortcutFor(map, key({ key: "F1" }), false)).toBe("terminal-new");
    expect(gridShortcutFor(map, key({ key: "F1" }), true)).toBe("terminal-new");
  });

  it("leaves Shift+PageUp alone when only the bare key is bound (xterm's scrollback)", () => {
    expect(gridShortcutFor(KEYMAP, key({ key: "PageUp", shiftKey: true }), true)).toBeNull();
    expect(gridShortcutFor(KEYMAP, key({ key: "PageDown", shiftKey: true }), true)).toBeNull();
  });

  it("honours a binding that DOES ask for a modifier", () => {
    const shifted: Keymap = { "zoom-next": "Shift+PageDown" };
    expect(gridShortcutFor(shifted, key({ key: "PageDown", shiftKey: true }), true)).toBe("zoom-next");
    expect(gridShortcutFor(shifted, key({ key: "PageDown" }), true)).toBeNull();
  });

  it("leaves every other modifier combination alone", () => {
    expect(gridShortcutFor(KEYMAP, key({ altKey: true }), true)).toBeNull();
    expect(gridShortcutFor(KEYMAP, key({ ctrlKey: true }), true)).toBeNull();
    expect(gridShortcutFor(KEYMAP, key({ metaKey: true }), true)).toBeNull();
  });

  it("ignores anything that isn't a keydown", () => {
    expect(gridShortcutFor(KEYMAP, key({ type: "keyup" }), true)).toBeNull();
    expect(gridShortcutFor(KEYMAP, key({ type: "keypress" }), true)).toBeNull();
  });

  it("ignores the keystroke while an IME is composing — it pages the candidate list", () => {
    expect(gridShortcutFor(KEYMAP, key({ isComposing: true }), true)).toBeNull();
  });

  it("ignores unbound keys", () => {
    expect(gridShortcutFor(KEYMAP, key({ key: "ArrowDown" }), true)).toBeNull();
    expect(gridShortcutFor(KEYMAP, key({ key: "" }), true)).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("treats form fields as editable", () => {
    expect(isEditableTarget("INPUT", [])).toBe(true);
    expect(isEditableTarget("TEXTAREA", [])).toBe(true);
    expect(isEditableTarget("SELECT", [])).toBe(true);
  });

  it("does NOT treat xterm's helper textarea as editable — the shortcut must work there", () => {
    expect(isEditableTarget("TEXTAREA", ["xterm-helper-textarea"])).toBe(false);
  });

  it("keeps other classes on a textarea editable", () => {
    expect(isEditableTarget("TEXTAREA", ["some-other-class"])).toBe(true);
  });

  it("is case-insensitive about the tag name", () => {
    expect(isEditableTarget("input", [])).toBe(true);
    expect(isEditableTarget("textarea", [])).toBe(true);
  });

  it("leaves non-form elements alone", () => {
    expect(isEditableTarget("DIV", [])).toBe(false);
    expect(isEditableTarget("BUTTON", [])).toBe(false);
    expect(isEditableTarget("", [])).toBe(false);
  });
});

// #900: `copy` / `paste` share the one `keymap` block, but the grid handler must never claim
// them — it ends every match with preventDefault(), and for `paste` that cancels the browser's
// own paste, which IS the mechanism. They are decided in the terminal instead.
describe("terminal-scoped actions never reach the grid", () => {
  const keymap = { copy: "Ctrl+c", paste: "Ctrl+v", "zoom-next": "PageDown" };
  const press = (k: string, ctrl = false) => ({ type: "keydown", key: k, shiftKey: false, altKey: false, ctrlKey: ctrl, metaKey: false });

  it("refuses copy and paste in both zoomed and un-zoomed grids", () => {
    [true, false].forEach((zoomed) => {
      expect(gridShortcutFor(keymap, press("c", true), zoomed)).toBeNull();
      expect(gridShortcutFor(keymap, press("v", true), zoomed)).toBeNull();
    });
  });

  it("still resolves the grid's own actions", () => {
    expect(gridShortcutFor(keymap, press("PageDown"), true)).toBe("zoom-next");
  });
});
